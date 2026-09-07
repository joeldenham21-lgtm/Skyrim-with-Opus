extends RadiusPanel
## Form 61-Q — the supply crate, kept as a requisition ledger: an index of categories down the left, the stock
## itself on the right with one line of particulars, a weight and a price. Lines above the Explorer's clearance
## stay printed but are struck through with the grade required. RETURN buys back at 40 % of list, condition
## weighted; artifacts are submitted at the terminal, never here.

const CATS := [["weapons", "Weapons"], ["ammo", "Ammunition"], ["mags", "Magazines"], ["attachments", "Attachments"],
	["armor", "Body armour"], ["helmets", "Helmets"], ["packs", "Packs and rigs"], ["head", "Headgear and masks"],
	["med", "Medical"], ["food", "Provisions"], ["tools", "Tools"], ["grenades", "Grenades"], ["parts", "Parts"]]
const CAT_OF := { "weapon": "weapons", "ammo": "ammo", "mag": "mags", "attachment": "attachments", "armor": "armor",
	"helmet": "helmets", "pack": "packs", "rig": "packs", "headgear": "head", "mask": "head", "med": "med",
	"food": "food", "tool": "tools", "battery": "tools", "filter": "tools", "melee": "tools", "grenade": "grenades", "part": "parts" }
const AMMO_LOT := 10
const BUYBACK := 0.4
const KIND_WORD := { "fmj": "Ball", "hp": "Expanding", "ap": "Armour-piercing", "sub": "Subsonic", "tracer": "Tracer",
	"buck": "Buckshot", "slug": "Slug", "flechette": "Flechette" }
const MODE_WORD := { "semi": "semi", "auto": "auto", "bolt": "bolt", "pump": "pump", "break": "break-open" }

var mode := "buy"
var cat := "weapons"

func panel_id() -> String: return "supply"
func title_text() -> String: return "Vanno · Supply crate"
func form_code() -> String: return "61-Q"
func key_hint() -> String: return "Esc close · arrows move · Enter confirm · 1-2 requisition or return"
func sheet_size(vp: Vector2) -> Vector2:
	return Vector2(minf(vp.x - 70.0, 1500.0), minf(vp.y - 50.0, 960.0))

func on_open() -> void:
	if str(data.get("tab", "")) in ["buy", "sell"]: mode = str(data["tab"])
	if data.has("cat"): cat = str(data["cat"])

# ------------------------------------------------------------------------------------------------------------------
func build() -> void:
	if not has_inv():
		add_child(PaperUI.empty("No kit on file.")); return
	add_child(_strip())
	add_child(PaperUI.spacer(6))
	add_child(PaperUI.tabs([["buy", "Requisition"], ["sell", "Return"]], mode, _pick_mode))
	add_child(PaperUI.spacer(4))
	var by := _catalogue() if mode == "buy" else _sellables()
	var cats: Array = []
	for c in CATS:
		if mode == "buy" or (by.has(str(c[0])) and not by[str(c[0])].is_empty()): cats.append(c)
	if cats.is_empty(): cats = [["med", "Medical"]]
	var has_cat := false
	for c in cats: if str(c[0]) == cat: has_cat = true
	if not has_cat: cat = str(cats[0][0])
	var cols := PaperUI.rowbox(0)
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(cols)
	cols.add_child(_index(cats, by))
	var gut := HBoxContainer.new()
	gut.custom_minimum_size = Vector2(29, 0)
	gut.add_child(PaperUI.hspacer(14))
	gut.add_child(PaperUI.Rule.new("solid", Paper.ink(0.20), true))
	gut.add_child(PaperUI.hspacer(14))
	cols.add_child(gut)
	cols.add_child(_ledger(by))
	add_child(PaperUI.note("Requisitions are deducted from contract funds. Weapons are issued loaded, magazines empty, ammunition in lots of ten. Lines above the Explorer's clearance are printed but not issued." if mode == "buy"
		else "Buy-back at 40 % of list, weighted by condition. A weapon goes with its attachments and inserted magazine; loaded rounds are returned to the kit first. Artifacts are submitted at the terminal, not here."))

func _strip() -> Control:
	var i: Inventory = inv()
	var h := PaperUI.rowbox(24)
	h.custom_minimum_size = Vector2(0, 20)
	h.add_child(PaperUI.caps("Clearance %d · %s" % [rank(), rank_title()], Paper.S_MICRO, Paper.ink(0.62)))
	h.add_child(PaperUI.caps("Requisition at list" if mode == "buy" else "Return at 40 % of list", Paper.S_MICRO, Paper.ink(0.62)))
	h.add_child(PaperUI.stretch())
	var over := i.overweight()
	h.add_child(PaperUI.caps("Load %s / %s kg%s" % [String.num(i.weight(), 1), String.num(i.capacity(), 0),
		(" · over by %s" % Paper.kg(over)) if over > 0.0 else ""], Paper.S_MICRO, Paper.RED if over > 0.0 else Paper.ink(0.62)))
	h.add_child(PaperUI.caps("Funds %s" % Paper.money(money()), Paper.S_MICRO, Paper.AMBER))
	return h

func _index(cats: Array, by: Dictionary) -> Control:
	var col := PaperUI.pane(212, 0)
	col.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	col.add_child(sc)
	for c in cats:
		var id := str(c[0])
		var list: Array = by.get(id, [])
		var open_n := 0
		if mode == "buy":
			for d in list:
				if int(d.get("rank", 1)) <= rank(): open_n += 1
		else:
			open_n = list.size()
		var b := PaperUI.select_row(_pick_cat.bind(id), id == cat)
		b.set_meta("fkey", "cat:" + id)
		b.custom_minimum_size = Vector2(0, 26)
		var h := PaperUI.rowbox(6)
		h.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		h.offset_left = 8; h.offset_right = -8
		h.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var l := PaperUI.caps(str(c[1]), Paper.S_MICRO, Paper.INK if id == cat else Paper.ink(0.62))
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		h.add_child(l)
		var count := "%d" % open_n
		if mode == "buy" and list.size() > open_n: count += " / %d" % list.size()
		var cl := PaperUI.caps(count, Paper.S_MICRO, Paper.AMBER if id == cat else Paper.ink(0.45))
		cl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		h.add_child(cl)
		b.add_child(h)
		v.add_child(b)
		v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.16)))
	return col

func _ledger(by: Dictionary) -> Control:
	var col := PaperUI.column(0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var list: Array = by.get(cat, [])
	var head := PaperUI.rowbox(10)
	head.custom_minimum_size = Vector2(0, 24)
	head.add_child(PaperUI.caps(_cat_label(cat), Paper.S_TINY, Paper.INK, true))
	head.add_child(PaperUI.caps(str(list.size()), Paper.S_MICRO, Paper.ink(0.50)))
	head.add_child(PaperUI.stretch())
	head.add_child(PaperUI.caps("weight", Paper.S_MICRO, Paper.ink(0.40)))
	head.add_child(PaperUI.hspacer(46))
	head.add_child(PaperUI.caps("price", Paper.S_MICRO, Paper.ink(0.40)))
	head.add_child(PaperUI.hspacer(96))
	col.add_child(head)
	col.add_child(PaperUI.Rule.new("solid", Paper.ink(0.30)))
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	col.add_child(sc)
	if list.is_empty():
		v.add_child(PaperUI.empty("Nothing in this category is stocked." if mode == "buy" else "Nothing to return in this category."))
	for x in list:
		if mode == "buy": v.add_child(_shop_row(x))
		else: v.add_child(_sell_row(x))
	return col

func _cat_label(id: String) -> String:
	for c in CATS:
		if str(c[0]) == id: return str(c[1])
	return id.capitalize()

# ------------------------------------------------------------------------------------------------------------------
# requisition
# ------------------------------------------------------------------------------------------------------------------
func _max_rank() -> int:
	var m := 1
	for k in Data.ranks.values(): m = maxi(m, int(k.get("rank", 1)))
	return m

func _catalogue() -> Dictionary:
	var by := {}
	for d in Data.shop_items(_max_rank()):
		var key := str(CAT_OF.get(Data.category_of(str(d.get("id", ""))), ""))
		if key == "": continue
		if not by.has(key): by[key] = []
		by[key].append(d)
	for k in by.keys():
		by[k].sort_custom(func(a, b):
			var ra := int(a.get("rank", 1)); var rb := int(b.get("rank", 1))
			if ra != rb: return ra < rb
			return int(a.get("price", 0)) < int(b.get("price", 0)))
	return by

func _lot(id: String) -> int: return AMMO_LOT if Data.ammo.has(id) else 1

func _shop_row(d: Dictionary) -> Control:
	var i: Inventory = inv()
	var id := str(d.get("id", ""))
	var locked := int(d.get("rank", 1)) > rank()
	var qty := _lot(id)
	var price := Data.price_of(id) * qty
	var w := Data.weight_of(id, qty)
	if Data.weapons.has(id) and d.get("defaultMag") != null: w += Data.weight_of(str(d["defaultMag"]))
	var carried := _carried_count(id)
	var tags: Array = []
	if carried > 0: tags.append(["carried %d" % carried, Paper.ink(0.52)])
	var acts: Array = []
	if locked:
		acts.append(PaperUI.act("Clearance %d" % int(d.get("rank", 1)), Callable(), { "disabled": true }))
	else:
		acts.append(PaperUI.act("Buy", _buy.bind(id), { "deny": money() < price, "tooltip": "" if money() >= price else "Insufficient funds" }))
	var name_col := Paper.ink(0.45) if locked else Paper.INK
	var block := PaperUI.name_block(str(d.get("full", d.get("name", id))), _line_of(d), tags, name_col)
	var h := PaperUI.rowbox(12)
	h.custom_minimum_size = Vector2(0, 34)
	block.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	block.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if locked: block.modulate = Color(1, 1, 1, 0.62)
	h.add_child(block)
	var wl := PaperUI.number(Paper.kg_num(w, 2 if w < 0.1 else 1), "kg")
	wl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	wl.custom_minimum_size = Vector2(92, 0)
	h.add_child(wl)
	var pl := PaperUI.number(Paper.money_num(price), "RUB", Paper.ink(0.45) if locked else Paper.AMBER)
	pl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	pl.custom_minimum_size = Vector2(118, 0)
	h.add_child(pl)
	var ab := PaperUI.rowbox(6)
	ab.size_flags_horizontal = Control.SIZE_SHRINK_END
	ab.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	for a in acts: ab.add_child(a)
	h.add_child(ab)
	var v := PaperUI.column(0)
	v.add_child(h)
	v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
	return v

func _carried_count(id: String) -> int:
	var i: Inventory = inv()
	if Data.weapons.has(id):
		var n := 0
		for w in i.weapons: if str(w["id"]) == id: n += 1
		return n
	if Data.magazines.has(id):
		var n2 := 0
		for m in i.mags: if str(m["id"]) == id: n2 += 1
		return n2
	if _is_instance(Data.def(id)):
		var n3 := 0
		for g in i.gear: if str(g["id"]) == id: n3 += 1
		return n3
	return i.count(id)

func _is_instance(d: Dictionary) -> bool:
	return str(d.get("kind", "")) in ["vest", "helmet", "backpack", "rig", "headgear", "mask", "melee"] \
		or d.get("durability") != null or d.get("battery") != null or d.get("filter") != null

## The one line under the name: the catalogue's own note, or the figures that matter for its kind.
func _line_of(d: Dictionary) -> String:
	var id := str(d.get("id", ""))
	var c := Data.category_of(id)
	var own := str(d.get("desc", "")).strip_edges()
	match c:
		"weapon":
			var mag := int(Data.magazines.get(str(d.get("defaultMag", "")), {}).get("cap", d.get("internal", 0)))
			var modes: Array = []
			for m in d.get("modes", []): modes.append(str(MODE_WORD.get(str(m), str(m))))
			return "%s · %s · %d rpm · %d rounds%s" % [Paper.cal_short(str(d.get("cal", ""))), " / ".join(modes),
				int(d.get("rpm", 0)), mag, " · integral suppressor" if d.get("suppressed") != null else ""]
		"ammo":
			var k := "Rubber" if d.get("blunt", false) else str(KIND_WORD.get(str(d.get("kind", "")), str(d.get("kind", "")).capitalize()))
			var dmg := "%d" % int(d.get("damage", 0))
			if int(d.get("pellets", 1)) > 1: dmg = "%d × %d" % [int(d["damage"]), int(d["pellets"])]
			return "%s · damage %s · penetration class %s%s · per 10 rounds" % [k, dmg, str(d.get("pen", 1)),
				" · quiet" if float(d.get("noise", 1.0)) < 0.7 else ""]
		"mag":
			var fits: Array = []
			for w in Data.weapons.values():
				if str(w.get("family", "")) in d.get("fits", []): fits.append(str(w.get("name", "")))
			return "%d rounds%s · fits %s" % [int(d.get("cap", 0)), ", clip" if d.get("clip", false) else "", ", ".join(fits)]
		"attachment":
			if own != "": return own
			var p: Array = []
			if d.get("gives") is Dictionary:
				var g: Array = []
				for s in d["gives"].keys(): g.append("%s %s" % [str(d["gives"][s]), str(s)])
				p.append("adds " + ", ".join(g))
			var fx := Paper.effects_text(d.get("effects", {}))
			if fx != "": p.append(fx)
			return " · ".join(p) if not p.is_empty() else "%s mount" % str(d.get("slot", "")).capitalize()
		"armor", "helmet":
			return "Class %s · covers %s · %s durability%s" % [str(d.get("cls", "-")), ", ".join(d.get("zones", [])),
				str(d.get("durability", 0)), (" · " + own) if own != "" else ""]
		"pack": return "+%s kg carried%s" % [str(d.get("capacity", 0)), (" · " + own) if own != "" else ""]
		"rig": return "%s magazine pouches%s%s" % [str(d.get("readyMags", 0)),
			(" · class %s insert" % str(d["armor"])) if d.get("armor") != null else "", (" · " + own) if own != "" else ""]
		"headgear": return own if own != "" else ("Night vision, generation %s" % str(d["nvg"]) if d.get("nvg") != null else "Headlamp")
		"mask": return own if own != "" else "Filters the gas."
		"melee": return "%sDamage %s." % [own + " " if own != "" else "", str(d.get("damage", "-"))]
		"grenade":
			var blast: String = "Blast %s m, %s." % [str(d.get("radius", 0)), str(d["damage"])] if d.get("damage") != null else "Radius %s m." % str(d.get("radius", 0))
			return "%s%s Fuse %s s." % [own + " " if own != "" else "", blast, str(d.get("fuse", 0))]
		"part": return "Restores the %s to 100 %% at the workbench." % str(d.get("part", ""))
		"filter": return "For the mask. %s minutes of gas." % str(d.get("filter", d.get("charge", 0)))
	if own != "": return own
	var e: Dictionary = d.get("effect", {})
	var lines: Array = []
	if e.get("heal") != null: lines.append("+%s" % str(e["heal"]))
	if e.get("healOver") is Array: lines.append("+%s over %s s" % [str(e["healOver"][0]), str(e["healOver"][1])])
	if e.get("stamina") != null: lines.append("stamina +%s" % str(e["stamina"]))
	if e.get("stopBleed", false): lines.append("stops bleeding")
	return (", ".join(lines) + ".").capitalize() if not lines.is_empty() else ""

# ------------------------------------------------------------------------------------------------------------------
# return
# ------------------------------------------------------------------------------------------------------------------
func _sell_price(entry: Dictionary) -> int:
	if economy() != null and economy().has_method("sell_price"): return int(economy().sell_price(entry))
	var d := Data.def(str(entry.get("id", "")))
	if str(d.get("kind", "")) == "artifact": return 0
	var base := float(d.get("price", 0))
	if str(entry.get("kind", "")) == "weapon" and entry.get("inst") is Dictionary:
		var w: Dictionary = entry["inst"]
		for v in w.get("attachments", {}).values(): base += Data.price_of(str(v))
		for r in w.get("rails", []): base += Data.price_of(str(r))
		if w.get("mag") is Dictionary: base += Data.price_of(str(w["mag"].get("id", "")))
		return roundi(base * (0.5 + 0.5 * Inventory.condition(w)) * BUYBACK)
	var qty := mini(_lot(str(entry.get("id", ""))), int(entry.get("count", 1)))
	if entry.has("uid"): qty = 1
	return roundi(base * qty * BUYBACK)

func _sellables() -> Dictionary:
	var i: Inventory = inv()
	var by := {}
	for e in KitView.entries(i):
		var id := str(e.get("id", ""))
		var d := Data.def(id)
		if int(d.get("price", 0)) <= 0: continue
		if str(d.get("kind", "")) in ["artifact", "mission", "key"]: continue
		var key := str(CAT_OF.get(Data.category_of(id), ""))
		if key == "": continue
		if not by.has(key): by[key] = []
		by[key].append(e)
	return by

func _sell_row(e: Dictionary) -> Control:
	var i: Inventory = inv()
	var id := str(e.get("id", ""))
	var price := _sell_price(e)
	var sub := ""
	var kind := str(e.get("kind", ""))
	if kind == "weapon" and e.get("inst") is Dictionary:
		var w: Dictionary = e["inst"]
		var n: int = w.get("attachments", {}).size() + w.get("rails", []).size()
		var loaded := Inventory.rounds_in(w)
		sub = "%s · condition %d %%%s" % ["with %d attachment%s" % [n, "" if n == 1 else "s"] if n > 0 else "no attachments",
			roundi(Paper.condition_of(w)), " · %d rounds returned to the kit" % loaded if loaded > 0 else ""]
	elif kind == "mag" and e.get("inst") is Dictionary:
		sub = "%s%s" % [Paper.mag_sub(e["inst"]), " · in the rig" if i.is_ready(int(e["inst"]["uid"])) else ""]
	elif e.has("uid"):
		var slot := KitView.slot_of_uid(i, int(e["uid"]))
		sub = "%s · %s" % ["worn" if slot != "" else "in the pack", KitView.entry_sub(e)]
	else:
		var q := mini(_lot(id), int(e.get("count", 1)))
		sub = "%d carried%s" % [int(e.get("count", 1)), " · %d per return" % q if q > 1 else ""]
	var qty := 1 if e.has("uid") else mini(_lot(id), int(e.get("count", 1)))
	var w2 := KitView.entry_weight(e) if e.has("uid") else Data.weight_of(id, qty)
	var h := PaperUI.rowbox(12)
	h.custom_minimum_size = Vector2(0, 34)
	var block := PaperUI.name_block(KitView.entry_name(e), sub)
	block.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	block.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(block)
	var wl := PaperUI.number(Paper.kg_num(w2, 2 if w2 < 0.1 else 1), "kg")
	wl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	wl.custom_minimum_size = Vector2(92, 0)
	h.add_child(wl)
	var pl := PaperUI.number(Paper.money_num(price), "RUB", Paper.AMBER)
	pl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	pl.custom_minimum_size = Vector2(118, 0)
	h.add_child(pl)
	var ab := PaperUI.rowbox(6)
	ab.size_flags_horizontal = Control.SIZE_SHRINK_END
	ab.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	ab.add_child(PaperUI.act("Return", _sell.bind(e), { "disabled": price <= 0 }))
	h.add_child(ab)
	var v := PaperUI.column(0)
	v.add_child(h)
	v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
	return v

# ------------------------------------------------------------------------------------------------------------------
# actions
# ------------------------------------------------------------------------------------------------------------------
func _pick_mode(id: String) -> void:
	mode = id
	snd("ui_tab", 0.4)
	refresh()

func _pick_cat(id: String) -> void:
	cat = id
	snd("paper_flip", 0.35)
	refresh()

func _buy(id: String) -> void:
	var d := Data.def(id)
	if int(d.get("rank", 1)) > rank():
		deny("Clearance %d required. Current clearance %d." % [int(d.get("rank", 1)), rank()]); return
	var e: Node = economy()
	if e != null and e.has_method("buy"):
		var r: Dictionary = e.buy(id)
		if not bool(r.get("ok", false)):
			deny(str(r.get("text", "Not issued."))); refresh(); return
		notice(str(r.get("text", "")), inv().overweight() > 0.0)
	else:
		var qty := _lot(id)
		var price := Data.price_of(id) * qty
		var i: Inventory = inv()
		if not i.spend(price):
			deny("Insufficient funds. %s required, %s on hand." % [Paper.money(price), Paper.money(money())]); return
		match Data.category_of(id):
			"weapon": i.add_weapon(Inventory.make_weapon(id))
			"mag": i.add_mag(Inventory.make_mag(id))
			"ammo": i.add(id, qty)
			_:
				if _is_instance(d): i.add_gear(Inventory.make_gear(id))
				else: i.add(id, 1)
		notice("%s issued. %s deducted." % [str(d.get("name", id)), Paper.money(price)])
	_changed()
	snd("ui_buy", 0.5)
	refresh()

func _sell(e: Dictionary) -> void:
	var ec: Node = economy()
	if ec != null and ec.has_method("sell"):
		var r: Dictionary = ec.sell(e)
		if not bool(r.get("ok", false)):
			deny(str(r.get("text", "The crate does not take that back."))); return
		notice(str(r.get("text", "")))
	else:
		var i: Inventory = inv()
		var price := _sell_price(e)
		if price <= 0: deny("The crate does not take that back."); return
		var id := str(e.get("id", ""))
		match str(e.get("kind", "")):
			"weapon":
				var w: Variant = i.weapon_by_uid(int(e.get("uid", -1)))
				if not (w is Dictionary): return
				if w.get("mag") is Dictionary: i.unload_mag(w["mag"])
				if w.get("chamber") != null: i.add(str(w["chamber"]), 1); w["chamber"] = null
				for a in w.get("tube", []): i.add(str(a), 1)
				w["tube"] = []
				i.remove_weapon(int(w["uid"]))
			"mag":
				var m: Variant = i.mag_by_uid(int(e.get("uid", -1)))
				if not (m is Dictionary): return
				i.unload_mag(m); i.remove_mag(int(m["uid"]))
			_:
				if e.has("uid"): i.remove_gear(int(e["uid"]))
				else:
					var q := mini(_lot(id), i.count(id))
					if q <= 0 or not i.remove(id, q): return
		i.earn(price)
		notice("%s returned. %s credited." % [KitView.entry_name(e), Paper.money(price)])
	_changed()
	snd("ui_buy", 0.5)
	refresh()

func _changed() -> void:
	if Game.player == null or not is_instance_valid(Game.player): return
	var w: Variant = Game.player.get("weapons")
	if w != null and is_instance_valid(w) and w.has_method("on_inventory_changed"): w.on_inventory_changed()
