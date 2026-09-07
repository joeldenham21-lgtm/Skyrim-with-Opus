class_name Inventory
extends RefCounted
## Inventory v2 (GEAR.md §2). Plain data in Game.state["inventory"] / ["storage"] so it saves as JSON; every id is a
## catalogue id from Data. Instances are Dictionaries:
##   weapon  { uid, id, parts{barrel,bolt,frame} 0..100, dirt 0..1, jammed, chamber: ammoId|null, mag: MagInst|null,
##             tube: [ammoId], fireMode, attachments{slot:id}, rails[id] }
##   mag     { uid, id, cal, ammo: ammoId|null, rounds }           one ammunition type per magazine
##   gear    { uid, id, durability?, charge?, uses? }              armour, packs, rigs, headgear, masks, tools with charge
##   items   { id: count }                                          stackables (loose rounds by ammo id, meds, grenades, parts, artifacts)
##   equipment { primary, secondary, sidearm, melee, vest, helmet, backpack, rig, headgear, mask } -> uid|null
##   readyMags [uid]  magazines in the rig pouches (fast reloads);  quick [id|null x4]  hotkeys 6..9
## Game.inventory wraps the carried kit, Game.storage the base stash (unlimited, no equipment). The browser API is kept
## in snake_case so panels, weapons and the base port straight across.

const SLOTS := ["primary", "secondary", "sidearm", "melee"]
const GEAR_SLOTS := ["vest", "helmet", "backpack", "rig", "headgear", "mask"]
const ALL_SLOTS := ["primary", "secondary", "sidearm", "melee", "vest", "helmet", "backpack", "rig", "headgear", "mask"]
const BASE_CAPACITY := 10.0          # kg carried without a backpack
const SPRINT_LOAD := 1.5             # at 1.5x capacity you cannot sprint
const KIND_SLOT := { "vest": "vest", "helmet": "helmet", "backpack": "backpack", "rig": "rig", "headgear": "headgear", "mask": "mask", "melee": "melee" }
static var _uid: int = 1

var key := "inventory"               # Game.state key this instance wraps
var is_storage := false

func _init(state_key: String = "inventory") -> void:
	key = state_key
	is_storage = state_key == "storage"
	sync()

# ------------------------------------------------------------------------------------------------------------------
# static: instances
# ------------------------------------------------------------------------------------------------------------------
static func next_uid() -> int:
	_uid += 1
	return _uid - 1

static func make_weapon(id: String, opts: Dictionary = {}) -> Dictionary:
	var d: Dictionary = Data.weapons.get(id, {})
	if d.is_empty():
		push_warning("Inventory.make_weapon: unknown weapon " + id)
		return {}
	var modes: Array = d.get("modes", ["semi"])
	var w := { "uid": next_uid(), "id": id, "parts": { "barrel": 100.0, "bolt": 100.0, "frame": 100.0 }, "dirt": 0.0, "jammed": false,
		"chamber": null, "mag": null, "tube": [], "fireMode": modes[0], "attachments": {}, "rails": [] }
	var ammo: String = str(opts.get("ammo", ""))
	if ammo == "" or not Data.ammo.has(ammo): ammo = Data.default_ammo(str(d.get("cal", "")))
	if opts.has("condition"):
		var c := clampf(float(opts["condition"]), 0.0, 100.0)
		w["parts"] = { "barrel": c, "bolt": c, "frame": c }
	var loaded: bool = bool(opts.get("loaded", true))
	var internal := int(d.get("internal", 0))
	if internal > 0:
		var brk: bool = str(modes[0]) == "break"
		var n := 0 if not loaded else internal - (0 if brk else 1)
		for i in n: w["tube"].append(ammo)
		if not brk and loaded: w["chamber"] = ammo
	elif d.get("defaultMag") != null and loaded:
		var mid := str(d["defaultMag"])
		w["mag"] = make_mag(mid, ammo, int(Data.magazines.get(mid, {}).get("cap", 0)))
		w["chamber"] = ammo
	for a in opts.get("attachments", []): attach(w, str(a))
	if opts.has("dirt"): w["dirt"] = clampf(float(opts["dirt"]), 0.0, 1.0)
	return w

static func make_mag(mag_id: String, ammo: Variant = null, rounds: int = 0) -> Dictionary:
	var m: Dictionary = Data.magazines.get(mag_id, {})
	if m.is_empty():
		push_warning("Inventory.make_mag: unknown magazine " + mag_id)
		return {}
	var n := mini(rounds, int(m.get("cap", 0)))
	return { "uid": next_uid(), "id": mag_id, "cal": str(m.get("cal", "")), "ammo": (ammo if n > 0 and ammo != null else null), "rounds": maxi(0, n) }

static func make_gear(id: String, opts: Dictionary = {}) -> Dictionary:
	var d: Dictionary = Data.def(id)
	if d.is_empty():
		push_warning("Inventory.make_gear: unknown gear " + id)
		return {}
	var g := { "uid": next_uid(), "id": id }
	if d.get("durability") != null: g["durability"] = float(opts.get("durability", d["durability"]))
	if d.get("battery") != null or d.get("charge") != null or d.get("filter") != null: g["charge"] = float(opts.get("charge", 100.0))
	if d.get("uses") != null: g["uses"] = int(opts.get("uses", d["uses"]))
	return g

## attach: false when it does not fit. Rails go into w.rails (they convert mount standards); others into attachments[slot].
static func attach(w: Dictionary, att_id: String) -> bool:
	var a: Dictionary = Data.attachments.get(att_id, {})
	var d: Dictionary = Data.weapons.get(str(w.get("id", "")), {})
	if a.is_empty() or d.is_empty(): return false
	var rails: Array = w.get("rails", [])
	if not Data.attachment_fits(a, d, rails): return false
	if str(a.get("slot", "")) == "rail":
		if att_id in rails: return false
		if not w.has("rails"): w["rails"] = []
		w["rails"].append(att_id)
		return true
	if not w.has("attachments"): w["attachments"] = {}
	var slot := str(a.get("slot", ""))
	if w["attachments"].has(slot) and w["attachments"][slot] != null: return false
	w["attachments"][slot] = att_id
	return true

## detach: true/false for ordinary attachments; for a rail returns { "dropped": [ids] } of the attachments that lost
## their mount (they are removed from the weapon; the caller puts them back in the kit).
static func detach(w: Dictionary, att_id: String) -> Variant:
	var a: Dictionary = Data.attachments.get(att_id, {})
	if a.is_empty(): return false
	var atts: Dictionary = w.get("attachments", {})
	if str(a.get("slot", "")) == "rail":
		var rails: Array = w.get("rails", [])
		var i := rails.find(att_id)
		if i < 0: return false
		rails.remove_at(i)
		var dropped: Array = []
		var d: Dictionary = Data.weapons.get(str(w.get("id", "")), {})
		for slot in atts.keys():
			var id := str(atts[slot])
			var att: Dictionary = Data.attachments.get(id, {})
			if att.is_empty() or not Data.attachment_fits(att, d, rails):
				dropped.append(id); atts.erase(slot)
		return { "dropped": dropped }
	for slot in atts.keys():
		if str(atts[slot]) == att_id:
			atts.erase(slot); return true
	return false

## Live effects of a weapon's attachments (multiplied together) plus wear and fouling.
static func weapon_effects(w: Dictionary) -> Dictionary:
	var e := { "zoom": 1.0, "reticle": null, "adsSpeed": 1.0, "recoil": 1.0, "moa": 1.0, "noise": 1.0, "flash": 1.0, "light": 0.0,
		"laser": false, "ergo": 0.0, "wear": 1.0, "nvOptic": false, "prone": false, "zoomLow": null }
	var d: Dictionary = Data.weapons.get(str(w.get("id", "")), {})
	if d.get("suppressed") != null:
		e["noise"] *= float(d["suppressed"]); e["flash"] *= 0.1
	var ids: Array = []
	for v in w.get("attachments", {}).values(): ids.append(str(v))
	for r in w.get("rails", []): ids.append(str(r))
	for id in ids:
		var a: Dictionary = Data.attachments.get(id, {})
		if a.is_empty() or not a.has("effects"): continue
		for k in a["effects"].keys():
			var v: Variant = a["effects"][k]
			match str(k):
				"zoom", "adsSpeed", "recoil", "moa", "noise", "flash", "wear": e[k] = float(e[k]) * float(v)
				"ergo": e["ergo"] = float(e["ergo"]) + float(v)
				"light": e["light"] = maxf(float(e["light"]), float(v))
				_: e[k] = v
	var barrel := float(w.get("parts", {}).get("barrel", 100.0))
	e["moa"] = float(e["moa"]) * (1.0 + (1.0 - barrel / 100.0) * 0.9 + float(w.get("dirt", 0.0)) * 0.15)
	return e

static func weapon_weight(w: Dictionary) -> float:
	var kg := Data.weight_of(str(w.get("id", "")))
	for v in w.get("attachments", {}).values(): kg += Data.weight_of(str(v))
	for r in w.get("rails", []): kg += Data.weight_of(str(r))
	if w.get("mag") is Dictionary: kg += mag_weight(w["mag"])
	kg += float(w.get("tube", []).size()) * 0.02
	return kg

static func mag_weight(m: Dictionary) -> float:
	var per := Data.weight_of(str(m["ammo"])) if m.get("ammo") != null else 0.012
	return Data.weight_of(str(m.get("id", ""))) + float(int(m.get("rounds", 0))) * per

## Rounds in the gun: magazine or tube plus the chambered round.
static func rounds_in(w: Dictionary) -> int:
	var n := 0
	if w.get("mag") is Dictionary: n += int(w["mag"].get("rounds", 0))
	else: n += w.get("tube", []).size()
	return n + (1 if w.get("chamber") != null else 0)

static func condition(w: Dictionary) -> float:
	var p: Dictionary = w.get("parts", {})
	return (float(p.get("barrel", 100.0)) + float(p.get("bolt", 100.0)) + float(p.get("frame", 100.0))) / 300.0

## The starter kit (DESIGN.md §4, GEAR.md §2): a PM with two magazines, belt pouches, a daypack, a knife and the torch.
static func default_inventory() -> Dictionary:
	var pm := make_weapon("pm")
	var inv := { "weapons": [pm], "mags": [make_mag("mag_pm8", "9x18_fmj", 8), make_mag("mag_pm8", "9x18_fmj", 8)], "gear": [],
		"items": { "bandage": 2, "probe": 6, "battery": 1, "9x18_fmj": 16, "cigarettes": 1 },
		"equipment": { "primary": null, "secondary": null, "sidearm": pm.get("uid"), "melee": null, "vest": null, "helmet": null, "backpack": null, "rig": null, "headgear": null, "mask": null },
		"quick": ["bandage", null, null, null], "readyMags": [] }
	var rig := make_gear("rig_belt"); var pack := make_gear("pack_tortilla"); var knife := make_gear("knife"); var torch := make_gear("torch")
	for g in [rig, pack, knife, torch]: if not g.is_empty(): inv["gear"].append(g)
	inv["equipment"]["rig"] = rig.get("uid"); inv["equipment"]["backpack"] = pack.get("uid"); inv["equipment"]["melee"] = knife.get("uid")
	for m in inv["mags"]: inv["readyMags"].append(m["uid"])
	return inv

static func empty_inventory() -> Dictionary:
	return { "weapons": [], "mags": [], "gear": [], "items": {}, "equipment": { "primary": null, "secondary": null, "sidearm": null, "melee": null, "vest": null, "helmet": null, "backpack": null, "rig": null, "headgear": null, "mask": null }, "quick": [null, null, null, null], "readyMags": [] }

## JSON brings numbers back as floats and may lack keys from older saves: coerce in place and keep the uid counter above
## every saved uid.
static func normalise(d: Dictionary) -> void:
	if not d.has("weapons"): d["weapons"] = []
	if not d.has("mags"): d["mags"] = []
	if not d.has("gear"): d["gear"] = []
	if not d.has("items"): d["items"] = {}
	if not d.has("equipment"): d["equipment"] = {}
	for s in ALL_SLOTS:
		if not d["equipment"].has(s): d["equipment"][s] = null
		elif d["equipment"][s] != null: d["equipment"][s] = int(d["equipment"][s])
	if not (d.get("quick") is Array): d["quick"] = [null, null, null, null]
	while d["quick"].size() < 4: d["quick"].append(null)
	if not (d.get("readyMags") is Array): d["readyMags"] = []
	for i in d["readyMags"].size(): d["readyMags"][i] = int(d["readyMags"][i])
	for w in d["weapons"]: _normalise_weapon(w)
	for m in d["mags"]: _normalise_mag(m)
	for g in d["gear"]:
		g["uid"] = int(g.get("uid", 0)); _bump(int(g["uid"]))
		if g.has("durability"): g["durability"] = float(g["durability"])
		if g.has("charge"): g["charge"] = float(g["charge"])
		if g.has("uses"): g["uses"] = int(g["uses"])
	for id in d["items"].keys(): d["items"][id] = int(d["items"][id])

static func _normalise_weapon(w: Dictionary) -> void:
	w["uid"] = int(w.get("uid", 0)); _bump(int(w["uid"]))
	if not (w.get("parts") is Dictionary): w["parts"] = { "barrel": 100.0, "bolt": 100.0, "frame": 100.0 }
	for k in ["barrel", "bolt", "frame"]: w["parts"][k] = float(w["parts"].get(k, 100.0))
	w["dirt"] = float(w.get("dirt", 0.0)); w["jammed"] = bool(w.get("jammed", false))
	if not (w.get("tube") is Array): w["tube"] = []
	if not (w.get("attachments") is Dictionary): w["attachments"] = {}
	if not (w.get("rails") is Array): w["rails"] = []
	if not w.has("chamber"): w["chamber"] = null
	if w.get("mag") is Dictionary: _normalise_mag(w["mag"])
	else: w["mag"] = null
	if not w.has("fireMode"): w["fireMode"] = Data.weapons.get(str(w.get("id", "")), {}).get("modes", ["semi"])[0]

static func _normalise_mag(m: Dictionary) -> void:
	m["uid"] = int(m.get("uid", 0)); _bump(int(m["uid"]))
	m["rounds"] = int(m.get("rounds", 0))
	if m["rounds"] <= 0: m["ammo"] = null
	if not m.has("cal"): m["cal"] = str(Data.magazines.get(str(m.get("id", "")), {}).get("cal", ""))

static func _bump(u: int) -> void:
	if u >= _uid: _uid = u + 1

# ------------------------------------------------------------------------------------------------------------------
# data access
# ------------------------------------------------------------------------------------------------------------------
func _d() -> Dictionary:
	var st: Dictionary = Game.state
	var d: Variant = st.get(key)
	if not (d is Dictionary) or not d.has("weapons") or (not is_storage and not d.has("equipment")):
		d = empty_inventory() if is_storage else default_inventory()
		st[key] = d
	return d

## Re-read the state after a load: coerce JSON numbers and lift the uid counter.
func sync() -> void:
	normalise(_d())
	if Game.state.get("storage") is Dictionary and key != "storage": normalise(Game.state["storage"])

var data: Dictionary:
	get: return _d()
var weapons: Array:
	get: return _d()["weapons"]
var mags: Array:
	get: return _d()["mags"]
var gear: Array:
	get: return _d()["gear"]
var items: Dictionary:
	get: return _d()["items"]
var equipment: Dictionary:
	get: return _d()["equipment"]
var quick: Array:
	get: return _d()["quick"]
var ready_mags: Array:
	get: return _d()["readyMags"]

func _emit(id: String, delta: int) -> void:
	Events.inventory_changed.emit(id, delta)

# ------------------------------------------------------------------------------------------------------------------
# stackables
# ------------------------------------------------------------------------------------------------------------------
func count(id: String) -> int: return int(_d()["items"].get(id, 0))
func has(id: String, n: int = 1) -> bool: return count(id) >= n
func add(id: String, n: int = 1) -> int:
	if n <= 0: return count(id)
	var it: Dictionary = _d()["items"]
	it[id] = int(it.get(id, 0)) + n
	_emit(id, n)
	return it[id]
func remove(id: String, n: int = 1) -> bool:
	var it: Dictionary = _d()["items"]
	if int(it.get(id, 0)) < n: return false
	it[id] = int(it[id]) - n
	if int(it[id]) <= 0: it.erase(id)
	_emit(id, -n)
	return true

## Stackables with `uses` (lockpicks, cleaning/repair kits): one physical item is worked through use by use.
## Returns false when none is carried; consumes one from the stack when its uses run out.
func uses_left(id: String) -> int:
	if count(id) <= 0: return 0
	var d := Data.def(id); var per := int(d.get("uses", 1))
	var f: Dictionary = Game.state.get("flags", {})
	return int(f.get("kitUses", {}).get(id, per))
func use_charge(id: String) -> bool:
	if count(id) <= 0: return false
	var per := int(Data.def(id).get("uses", 1))
	var f: Dictionary = Game.state["flags"]
	if not (f.get("kitUses") is Dictionary): f["kitUses"] = {}
	var left := int(f["kitUses"].get(id, per)) - 1
	if left <= 0:
		f["kitUses"].erase(id); remove(id, 1)
	else:
		f["kitUses"][id] = left; _emit(id, 0)
	return true

# ammo by ammo id (loose rounds); ammo_count by ammo id or by calibre ("9x18" sums all types)
func add_ammo(ammo_id: String, n: int) -> int:
	if not Data.ammo.has(ammo_id):
		var d := Data.default_ammo(ammo_id)
		if d != "": ammo_id = d
	return add(ammo_id, n)
func ammo_count(id_or_cal: String) -> int:
	if Data.ammo.has(id_or_cal): return count(id_or_cal)
	var n := 0
	for id in _d()["items"].keys():
		if Data.ammo.has(id) and str(Data.ammo[id].get("cal", "")) == id_or_cal: n += int(_d()["items"][id])
	return n
func take_ammo(ammo_id: String, n: int) -> int:
	var k := mini(count(ammo_id), n)
	if k > 0: remove(ammo_id, k)
	return k
func ammo_types_of(cal: String) -> Array:
	var out := []
	for id in _d()["items"].keys():
		if Data.ammo.has(id) and str(Data.ammo[id].get("cal", "")) == cal and int(_d()["items"][id]) > 0: out.append(id)
	return out
func preferred_ammo(cal: String) -> String:
	var f: Dictionary = Game.state.get("flags", {})
	var p := str(f.get("ammoPref", {}).get(cal, ""))
	if p != "" and count(p) > 0: return p
	var t := ammo_types_of(cal)
	return str(t[0]) if not t.is_empty() else Data.default_ammo(cal)
func set_preferred_ammo(cal: String, ammo_id: String) -> void:
	var f: Dictionary = Game.state["flags"]
	if not (f.get("ammoPref") is Dictionary): f["ammoPref"] = {}
	f["ammoPref"][cal] = ammo_id

# ------------------------------------------------------------------------------------------------------------------
# weapons
# ------------------------------------------------------------------------------------------------------------------
func add_weapon(w: Dictionary) -> Dictionary:
	if w.is_empty(): return w
	_d()["weapons"].append(w)
	if not is_storage:
		var d: Dictionary = Data.weapons.get(str(w["id"]), {})
		var e: Dictionary = _d()["equipment"]
		if str(d.get("cls", "")) == "pistol" and e.get("sidearm") == null: e["sidearm"] = w["uid"]
		elif e.get("primary") == null: e["primary"] = w["uid"]
		elif e.get("secondary") == null: e["secondary"] = w["uid"]
	_emit(str(w["id"]), 1)
	return w
func remove_weapon(uid: int) -> Variant:
	var list: Array = _d()["weapons"]
	for i in list.size():
		if int(list[i].get("uid", -1)) == uid:
			var w: Dictionary = list[i]; list.remove_at(i)
			var e: Dictionary = _d()["equipment"]
			for s in SLOTS: if e.get(s) != null and int(e[s]) == uid: e[s] = null
			_emit(str(w["id"]), -1)
			return w
	return null
func weapon_by_uid(uid: int) -> Variant:
	for w in _d()["weapons"]: if int(w.get("uid", -1)) == uid: return w
	return null
## weapon_in_slot(0..3) or weapon_in_slot("primary")
func weapon_in_slot(slot: Variant) -> Variant:
	var e: Dictionary = _d()["equipment"]
	var s: String = SLOTS[int(slot)] if (slot is int or slot is float) else str(slot)
	if not e.has(s) or e[s] == null: return null
	return weapon_by_uid(int(e[s]))
func equip_weapon(uid: int, slot: String) -> bool:
	if not (slot in SLOTS): return false
	if weapon_by_uid(uid) == null: return false
	var e: Dictionary = _d()["equipment"]
	for s in SLOTS: if e.get(s) != null and int(e[s]) == uid: e[s] = null
	e[slot] = uid
	_emit("equip", 0)
	return true

# ------------------------------------------------------------------------------------------------------------------
# magazines
# ------------------------------------------------------------------------------------------------------------------
func add_mag(m: Dictionary) -> Dictionary:
	if m.is_empty(): return m
	_d()["mags"].append(m)
	if not is_storage:
		var rig := equipped_def("rig")
		if _d()["readyMags"].size() < int(rig.get("readyMags", 0)): _d()["readyMags"].append(m["uid"])
	_emit(str(m["id"]), 1)
	return m
func remove_mag(uid: int) -> Variant:
	var list: Array = _d()["mags"]
	for i in list.size():
		if int(list[i].get("uid", -1)) == uid:
			var m: Dictionary = list[i]; list.remove_at(i)
			var r: Array = _d()["readyMags"]
			var k := r.find(uid)
			if k >= 0: r.remove_at(k)
			_emit(str(m["id"]), -1)
			return m
	return null
func mag_by_uid(uid: int) -> Variant:
	for m in _d()["mags"]: if int(m.get("uid", -1)) == uid: return m
	return null
func mags_for_weapon(w: Dictionary) -> Array:
	var fam := str(Data.weapons.get(str(w.get("id", "")), {}).get("family", ""))
	var out := []
	for m in _d()["mags"]:
		if fam in Data.magazines.get(str(m.get("id", "")), {}).get("fits", []): out.append(m)
	return out
func is_ready(mag_uid: int) -> bool: return mag_uid in _d()["readyMags"]
func ready_slots() -> int: return int(equipped_def("rig").get("readyMags", 0))
func set_ready(mag_uid: int, ready: bool) -> bool:
	var r: Array = _d()["readyMags"]
	if ready:
		if mag_uid in r: return true
		if r.size() >= ready_slots(): return false
		if mag_by_uid(mag_uid) == null: return false
		r.append(mag_uid)
	else:
		var i := r.find(mag_uid)
		if i >= 0: r.remove_at(i)
	_emit("equip", 0)
	return true
## Best magazine to reload with: ready first, then most rounds, then the preferred ammunition type (a 5-round edge).
func best_mag(w: Dictionary, exclude: Variant = null) -> Variant:
	var cal := str(Data.weapons.get(str(w.get("id", "")), {}).get("cal", ""))
	var pref := preferred_ammo(cal)
	var best: Variant = null; var bs := -1
	for m in mags_for_weapon(w):
		if exclude is Dictionary and int(m.get("uid", -1)) == int(exclude.get("uid", -2)): continue
		if int(m.get("rounds", 0)) <= 0: continue
		var s := int(m["rounds"]) + (1000 if is_ready(int(m["uid"])) else 0) + (5 if str(m.get("ammo", "")) == pref else 0)
		if s > bs: bs = s; best = m
	return best
## Load n loose rounds of ammo_id into a magazine (single ammunition type per magazine). Returns rounds loaded.
func load_mag(m: Dictionary, ammo_id: String, n: int = 1) -> int:
	var cap := int(Data.magazines.get(str(m.get("id", "")), {}).get("cap", 0))
	if int(m.get("rounds", 0)) > 0 and m.get("ammo") != null and str(m["ammo"]) != ammo_id: return 0
	var mcal := str(m.get("cal", "")); var acal := str(Data.ammo.get(ammo_id, {}).get("cal", ""))
	if mcal != "" and acal != mcal: return 0
	var k := mini(n, mini(cap - int(m.get("rounds", 0)), count(ammo_id)))
	if k <= 0: return 0
	remove(ammo_id, k)
	m["ammo"] = ammo_id; m["rounds"] = int(m.get("rounds", 0)) + k
	return k
func unload_mag(m: Dictionary) -> int:
	var n := int(m.get("rounds", 0))
	if n > 0 and m.get("ammo") != null: add(str(m["ammo"]), n)
	m["rounds"] = 0; m["ammo"] = null
	return n
## Fill every magazine that fits the weapon (and the inserted one) from loose rounds: each keeps its own ammunition
## type, empty ones take the preferred type. Returns rounds loaded.
func fill_mags(w: Dictionary) -> int:
	var loaded := 0
	var cal := str(Data.weapons.get(str(w.get("id", "")), {}).get("cal", ""))
	var list := mags_for_weapon(w)
	if w.get("mag") is Dictionary: list.append(w["mag"])
	for m in list:
		var a := str(m["ammo"]) if (m.get("ammo") != null and int(m.get("rounds", 0)) > 0) else preferred_ammo(cal)
		if a == "": continue
		loaded += load_mag(m, a, 999)
	return loaded

# ------------------------------------------------------------------------------------------------------------------
# gear (armour, packs, rigs, headgear, masks, tools with instances)
# ------------------------------------------------------------------------------------------------------------------
func add_gear(g: Dictionary) -> Dictionary:
	if g.is_empty(): return g
	_d()["gear"].append(g)
	if not is_storage:
		var slot: String = KIND_SLOT.get(str(Data.def(str(g["id"])).get("kind", "")), "")
		var e: Dictionary = _d()["equipment"]
		if slot != "" and e.get(slot) == null: e[slot] = g["uid"]
	_emit(str(g["id"]), 1)
	return g
func remove_gear(uid: int) -> Variant:
	var list: Array = _d()["gear"]
	for i in list.size():
		if int(list[i].get("uid", -1)) == uid:
			var g: Dictionary = list[i]; list.remove_at(i)
			var e: Dictionary = _d()["equipment"]
			for k in e.keys(): if e[k] != null and int(e[k]) == uid: e[k] = null
			_emit(str(g["id"]), -1)
			return g
	return null
func gear_by_uid(uid: int) -> Variant:
	for g in _d()["gear"]: if int(g.get("uid", -1)) == uid: return g
	return null
func equip_gear(uid: int, slot: String = "") -> bool:
	var g: Variant = gear_by_uid(uid)
	if g == null: return false
	var want: String = KIND_SLOT.get(str(Data.def(str(g["id"])).get("kind", "")), "")
	if slot == "": slot = want
	if slot == "" or slot != want: return false
	_d()["equipment"][slot] = uid
	_emit("equip", 0)
	return true
func unequip(slot: String) -> void:
	_d()["equipment"][slot] = null
	_emit("equip", 0)
func equipped(slot: String) -> Variant:
	var u: Variant = _d()["equipment"].get(slot)
	if u == null: return null
	var g: Variant = gear_by_uid(int(u))
	return g if g != null else weapon_by_uid(int(u))
func equipped_def(slot: String) -> Dictionary:
	var g: Variant = equipped(slot)
	return Data.def(str(g["id"])) if g is Dictionary else {}
## Armour pieces covering the player for Data.resolve_hit: [{ def, inst, slot }]. A rig with a soft insert counts as
## a class `armor` torso plate of 40 durability.
func armor_pieces() -> Array:
	var out := []
	for s in ["helmet", "vest", "rig"]:
		var g: Variant = equipped(s)
		if g == null: continue
		var d: Dictionary = Data.def(str(g["id"]))
		if d.is_empty(): continue
		if d.get("cls") != null: out.append({ "def": d, "inst": g, "slot": s })
		elif float(d.get("armor", 0)) > 0.0:
			out.append({ "def": { "id": d.get("id", ""), "name": d.get("name", ""), "cls": float(d["armor"]), "zones": ["torso"], "durability": 40.0 }, "inst": g, "slot": s })
	return out

# ------------------------------------------------------------------------------------------------------------------
# weight and load
# ------------------------------------------------------------------------------------------------------------------
func weight() -> float:
	var d := _d(); var kg := 0.0
	for w in d["weapons"]: kg += weapon_weight(w)
	for m in d["mags"]: kg += mag_weight(m)
	for g in d["gear"]: kg += Data.weight_of(str(g.get("id", "")))
	for id in d["items"].keys(): kg += Data.weight_of(str(id), int(d["items"][id]))
	return kg
func capacity() -> float:
	if is_storage: return INF
	return BASE_CAPACITY + float(equipped_def("backpack").get("capacity", 0))
func overweight() -> float: return maxf(0.0, weight() - capacity())
## 0 at or under capacity .. 1 at 1.5x capacity (no sprint). Walking slows to 0.6x over the same range (GEAR.md §2).
func load_factor() -> float:
	var c := capacity()
	if c <= 0.0 or is_inf(c): return 0.0
	return clampf((weight() - c) / (c * (SPRINT_LOAD - 1.0)), 0.0, 1.0)
func can_sprint() -> bool: return load_factor() < 1.0

# ------------------------------------------------------------------------------------------------------------------
# money
# ------------------------------------------------------------------------------------------------------------------
func money() -> int: return int(Game.state.get("money", 0))
func spend(n: int) -> bool:
	if money() < n: return false
	Game.state["money"] = money() - n
	_emit("money", -n)
	return true
func earn(n: int) -> void:
	Game.state["money"] = money() + n
	Game.state["earned"] = int(Game.state.get("earned", 0)) + n
	Events.earned.emit(n)
	_emit("money", n)
## Carried artifacts: [{ id, count, def }]
func artifacts() -> Array:
	var out := []
	for id in _d()["items"].keys():
		var d: Dictionary = Data.items.get(id, {})
		if str(d.get("kind", "")) == "artifact": out.append({ "id": id, "count": int(_d()["items"][id]), "def": d })
	return out

# ------------------------------------------------------------------------------------------------------------------
# quick slots (keys 6-9), lifecycle, listing, transfers
# ------------------------------------------------------------------------------------------------------------------
func set_quick(i: int, id: Variant) -> void:
	if i < 0 or i > 3: return
	_d()["quick"][i] = id
	_emit("quick", 0)
func drop_all() -> void:
	var d := _d(); var keep := default_inventory()
	for k in keep.keys(): d[k] = keep[k]
	_emit("*", 0)
func give_starter_kit() -> void:
	var d := _d(); var keep := default_inventory()
	for k in keep.keys(): d[k] = keep[k]
	_emit("*", 0)
## Everything as a flat list for panels: [{ kind, id, uid?, count, inst? }]
func list() -> Array:
	var d := _d(); var out := []
	for w in d["weapons"]: out.append({ "kind": "weapon", "id": w["id"], "uid": w["uid"], "count": 1, "inst": w })
	for m in d["mags"]: out.append({ "kind": "mag", "id": m["id"], "uid": m["uid"], "count": 1, "inst": m })
	for g in d["gear"]: out.append({ "kind": str(Data.def(str(g["id"])).get("kind", "gear")), "id": g["id"], "uid": g["uid"], "count": 1, "inst": g })
	for id in d["items"].keys(): out.append({ "kind": str(Data.def(str(id)).get("kind", "item")), "id": id, "count": int(d["items"][id]) })
	return out
## Move one list entry (as returned by list()) to another inventory (the stash and back). Weapons carry their
## inserted magazine and attachments; magazines leave the rig pouches.
func transfer(entry: Dictionary, to: Inventory, n: int = -1) -> bool:
	if to == null or to == self: return false
	match str(entry.get("kind", "")):
		"weapon":
			var w: Variant = remove_weapon(int(entry.get("uid", -1)))
			if w == null: return false
			to.add_weapon(w); return true
		"mag":
			var m: Variant = remove_mag(int(entry.get("uid", -1)))
			if m == null: return false
			to.add_mag(m); return true
		_:
			if entry.has("uid"):
				var g: Variant = remove_gear(int(entry["uid"]))
				if g == null: return false
				to.add_gear(g); return true
			var id := str(entry.get("id", ""))
			var k := count(id) if n < 0 else mini(n, count(id))
			if k <= 0 or not remove(id, k): return false
			to.add(id, k); return true
