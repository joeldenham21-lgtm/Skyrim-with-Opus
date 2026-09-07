extends Node
## Loot v2 (GEAR.md §6). Node "Loot" under Game (Game.loot).
##   Tables: data/containers.json rolls `rolls` times from category weights; each category picks an item by rarity
##   weight scaled by the location tier (data/poi_tier.json + tide level - 1), a rank gate and a price damper, so
##   rank-5 kit is genuinely rare and a village shelf never holds a Mark 4. Containers by POI kind from
##   data/containers_by_poi.json. Ammunition rolls AMMO_ROLL[rarity] x AMMO_SCALE and leans toward calibres you carry.
##   Containers: structures mark nodes with meta "container" (crate locker safe desk cabinet bag corpse shelf, or a
##   table name) and meta "poi". On first interaction Loot rolls them (locked lockers and safes need lockpicks, 3 tries
##   at 60 %, or a key from a desk), remembers the contents in Game.state.flags.loot (until the Tide) and opens the
##   loot panel: Events.open_panel("loot", data) with data.items and data.source; the panel calls take/take_all/put.
##   Piles: spawn_pile(pos, items, kind) drops what a mimic carried (MimicLoadout.drops_for), an explorer's remains,
##   or kit the player dropped; piles are interactables ("[E] SEARCH · MIMIC").
##   Explorer corpses lie at the church, the rail cutting, the marsh, the forest and the ridge (one each, re-placed
##   by the Tide): tags, letters, a pack of the explorer's things.
signal looted(entry: Dictionary, source: Node)
signal container_opened(source: Node, record: Dictionary)

const AMMO_SCALE := 0.75          # loot ammo quantities relative to data/ammo_roll.json (rounds are counted)
const OWNED_CAL_BIAS := 0.45      # chance an ammo roll is restricted to calibres of weapons carried
const PRICE_DAMP := 2500.0        # weight *= 1 / (1 + price / PRICE_DAMP) for kit; ammo uses PRICE_DAMP_AMMO per round
const PRICE_DAMP_AMMO := 25.0
const LOCKPICK_CHANCE := 0.6
const MAX_RECORDS := 320
const MAX_PILES := 64
const STRUCTURE_TABLES := {
	"crate": ["ammo_crate", "weapon_crate", "footlocker", "ammo_tin", "ration_box", "toolbox"],
	"locker": ["armor_locker", "footlocker"], "safe": ["safe"], "desk": ["desk"], "cabinet": ["med_cabinet", "shelf", "toolbox"],
	"bag": ["med_bag", "ammo_tin", "explorer_pack"], "corpse": ["explorer_pack"], "shelf": ["shelf"] }
const STRUCTURE_NAMES := { "crate": "CRATE", "locker": "LOCKER", "safe": "SAFE", "desk": "DESK", "cabinet": "CABINET", "bag": "BAG", "corpse": "EXPLORER", "shelf": "SHELF" }
const CORPSE_POIS := ["church", "rail", "marsh", "forest", "ridge"]
const CORPSE_NUMBERS := [44, 39, 52, 57, 60]
const MISSION_POOL := ["documents", "dogtag", "explorer_pack"]
var _pools := {}
var _piles: Array = []
var _corpses: Array = []
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	name = "Loot"
	_rng.randomize()
	if not Events.game_started.is_connected(_on_game_started): Events.game_started.connect(_on_game_started)
	if not Events.world_ready.is_connected(_on_world_ready): Events.world_ready.connect(_on_world_ready)
	if not Events.tide.is_connected(_on_tide): Events.tide.connect(_on_tide)

# ------------------------------------------------------------------------------------------------------------------
# tables
# ------------------------------------------------------------------------------------------------------------------
## Per-item weight by rarity and tier (BALANCE.md): the order common > uncommon > rare > epic holds at every tier
## (44/37/26/9.3 at tier 4) while epics go from 0.3 % of the weight at tier 0 to 8 % at tier 4.
static func rarity_weight(rarity: String, tier: int) -> float:
	var t := clampi(tier, 0, 4)
	match rarity:
		"common": return 60.0 - 4.0 * t
		"uncommon": return 25.0 + 3.0 * t
		"rare": return 6.0 + 5.0 * t
		"epic": return 0.5 + 2.2 * t
	return 1.0

func tide_level() -> int: return int(Game.state.get("tideLevel", 1))
## Location tier 0..4: POI danger tier plus the tide level minus one.
func tier_for(poi_kind: String) -> int:
	return clampi(int(Data.poi_tier.get(poi_kind, 1)) + tide_level() - 1, 0, 4)

func _pool(cat: String) -> Array:
	if _pools.has(cat): return _pools[cat]
	var out := []
	match cat:
		"ammo": out = Data.ammo.values()
		"mag": out = Data.magazines.values()
		"attachment": out = Data.attachments.values()
		"weapon": out = Data.weapons.values()
		"armor": for d in Data.armor.values(): if str(d.get("kind", "")) == "vest": out.append(d)
		"helmet": for d in Data.armor.values(): if str(d.get("kind", "")) == "helmet": out.append(d)
		"rig": for d in Data.armor.values(): if str(d.get("kind", "")) == "rig": out.append(d)
		"pack": for d in Data.armor.values(): if str(d.get("kind", "")) == "backpack" and not d.get("hidden", false): out.append(d)
		"headgear": for d in Data.armor.values(): if str(d.get("kind", "")) == "headgear": out.append(d)
		"mask": for d in Data.armor.values(): if str(d.get("kind", "")) == "mask": out.append(d)
		"mission": for id in MISSION_POOL: if Data.items.has(id): out.append(Data.items[id])
		"key": if Data.items.has("key_locker"): out.append(Data.items["key_locker"])
		_: for d in Data.items.values(): if str(d.get("kind", "")) == cat and not d.get("hidden", false): out.append(d)
	_pools[cat] = out
	return out

## Weight of one catalogue entry at a tier: rarity by tier, a rank gate (rank <= tier + 1, one grade over at a
## quarter), and a price damper inside the category.
func item_weight(d: Dictionary, tier: int, cat: String = "") -> float:
	var w := rarity_weight(str(d.get("rarity", "common")), tier)
	var rank := int(d.get("rank", 1))
	if rank > tier + 2: return 0.0
	if rank == tier + 2: w *= 0.25
	var price := float(d.get("price", 0))
	if cat == "ammo": w *= 1.0 / (1.0 + price / PRICE_DAMP_AMMO)
	elif cat != "artifact" and cat != "mission" and cat != "key": w *= 1.0 / (1.0 + price / PRICE_DAMP)
	return w

func _weighted(weights: Dictionary, rng: RandomNumberGenerator) -> String:
	var sum := 0.0
	for k in weights: sum += float(weights[k])
	if sum <= 0.0: return ""
	var r := rng.randf() * sum
	for k in weights:
		r -= float(weights[k])
		if r <= 0.0: return str(k)
	return str(weights.keys()[0])

func _pick_def(cat: String, tier: int, rng: RandomNumberGenerator, filter: Callable = Callable()) -> Dictionary:
	var pool := _pool(cat)
	var ws := []; var sum := 0.0
	for d in pool:
		if filter.is_valid() and not filter.call(d): ws.append(0.0); continue
		var w := item_weight(d, tier, cat); ws.append(w); sum += w
	if sum <= 0.0: return {}
	var r := rng.randf() * sum
	for i in pool.size():
		r -= ws[i]
		if r <= 0.0: return pool[i]
	return pool[pool.size() - 1]

func _owned_calibres() -> Array:
	var out := []
	if Game.inventory == null: return out
	for w in Game.inventory.weapons:
		var cal := str(Data.weapons.get(str(w.get("id", "")), {}).get("cal", ""))
		if cal != "" and not (cal in out): out.append(cal)
	return out

## One roll of a category into a loot entry ({ kind, id, count, inst? }); {} when the category yields nothing.
func roll_category(cat: String, tier: int, rng: RandomNumberGenerator = null) -> Dictionary:
	if rng == null: rng = _rng
	match cat:
		"ammo":
			var owned := _owned_calibres()
			var d := {}
			if not owned.is_empty() and rng.randf() < OWNED_CAL_BIAS:
				var cal: String = owned[rng.randi_range(0, owned.size() - 1)]
				d = _pick_def("ammo", tier, rng, func(a): return str(a.get("cal", "")) == cal)
			if d.is_empty(): d = _pick_def("ammo", tier, rng)
			if d.is_empty(): return {}
			var rr: Array = Data.ammo_roll.get(str(d.get("rarity", "common")), [8, 20])
			var n := int(roundf(rng.randi_range(int(rr[0]), int(rr[1])) * AMMO_SCALE))
			return { "kind": "item", "id": str(d["id"]), "count": maxi(1, n) }
		"mag":
			var d := _pick_def("mag", tier, rng)
			if d.is_empty(): return {}
			var cap := int(d.get("cap", 1))
			var rounds := 0 if rng.randf() < 0.4 else rng.randi_range(1, cap)
			var ammo := Data.default_ammo(str(d.get("cal", "")))
			return { "kind": "mag", "id": str(d["id"]), "count": 1, "inst": Inventory.make_mag(str(d["id"]), ammo, rounds) }
		"weapon":
			var d := _pick_def("weapon", tier, rng)
			if d.is_empty(): return {}
			var cal := str(d.get("cal", ""))
			var ammo := Data.default_ammo(cal)
			var ap := ""
			for a in Data.ammo.values(): if str(a.get("cal", "")) == cal and str(a.get("kind", "")) == "ap": ap = str(a["id"]); break
			if ap != "" and rng.randf() < 0.1 * tier: ammo = ap
			var cond := clampf(rng.randf_range(30.0 + 8.0 * tier, 70.0 + 6.0 * tier), 20.0, 95.0)
			var w := Inventory.make_weapon(str(d["id"]), { "condition": roundf(cond), "ammo": ammo, "dirt": rng.randf_range(0.25, 0.7) })
			if w.is_empty(): return {}
			if w.get("mag") is Dictionary:
				var cap := int(Data.magazines.get(str(w["mag"]["id"]), {}).get("cap", 1))
				w["mag"]["rounds"] = rng.randi_range(0, cap)
				if int(w["mag"]["rounds"]) == 0: w["mag"]["ammo"] = null
				w["chamber"] = ammo if rng.randf() < 0.6 else null
			elif w.get("tube", []).size() > 0:
				w["tube"].resize(rng.randi_range(0, w["tube"].size()))
			if rng.randf() < 0.1 + 0.05 * tier:
				var att := _pick_def("attachment", tier, rng, func(a): return str(a.get("slot", "")) != "rail" and Data.attachment_fits(a, d, []))
				if not att.is_empty(): Inventory.attach(w, str(att["id"]))
			return { "kind": "weapon", "id": str(d["id"]), "count": 1, "inst": w }
		"armor", "helmet", "rig", "pack", "headgear", "mask":
			var d := _pick_def(cat, tier, rng)
			if d.is_empty(): return {}
			var opts := {}
			if d.get("durability") != null: opts["durability"] = roundf(float(d["durability"]) * rng.randf_range(0.4, 1.0))
			if d.get("battery") != null or d.get("filter") != null: opts["charge"] = roundf(rng.randf_range(20.0, 100.0))
			return { "kind": "gear", "id": str(d["id"]), "count": 1, "inst": Inventory.make_gear(str(d["id"]), opts) }
		"melee":
			var d := _pick_def("melee", tier, rng)
			if d.is_empty(): return {}
			return { "kind": "gear", "id": str(d["id"]), "count": 1, "inst": Inventory.make_gear(str(d["id"])) }
		_:
			var d := _pick_def(cat, tier, rng)
			if d.is_empty(): return {}
			var id := str(d["id"]); var n := 1
			match id:
				"probe": n = rng.randi_range(2, 4)
				"bandage", "battery": n = rng.randi_range(1, 2)
			if cat == "grenade" and tier >= 3 and rng.randf() < 0.3: n = 2
			if cat == "tool" and int(d.get("stack", 10)) <= 1: n = 1
			return { "kind": "item", "id": id, "count": n }

func _merge(out: Array, e: Dictionary) -> void:
	if e.is_empty(): return
	if str(e.get("kind", "")) == "item":
		for x in out:
			if str(x.get("kind", "")) == "item" and str(x.get("id", "")) == str(e["id"]):
				x["count"] = int(x["count"]) + int(e["count"]); return
	out.append(e)

## Which table a structure container uses at a POI kind (a table name passes through).
func table_for(kind: String, poi_kind: String = "", rng: RandomNumberGenerator = null) -> String:
	if Data.containers.has(kind): return kind
	if rng == null: rng = _rng
	var cands: Array = STRUCTURE_TABLES.get(kind, STRUCTURE_TABLES["crate"])
	var by_poi: Dictionary = Data.containers_by_poi.get(poi_kind, {})
	var ws := {}
	for t in cands:
		if by_poi.has(t): ws[t] = float(by_poi[t])
	if ws.is_empty():
		for t in cands: ws[t] = 1.0
	var pick := _weighted(ws, rng)
	return pick if pick != "" else str(cands[0])

## Roll a container: kind is a table name or a structure kind (with poi_kind). Returns loot entries.
func roll_container(kind: String, tier: int, poi_kind: String = "", rng: RandomNumberGenerator = null) -> Array:
	if rng == null: rng = _rng
	var table_name := table_for(kind, poi_kind, rng)
	var t: Dictionary = Data.containers.get(table_name, {})
	var out := []
	if t.is_empty(): return out
	tier = clampi(maxi(tier, int(t.get("tierMin", 0))), 0, 4)
	if rng.randf() < float(t.get("empty", 0.0)): return out
	var rolls: Array = t.get("rolls", [1, 2])
	var n := rng.randi_range(int(rolls[0]), int(rolls[1]))
	var cats: Dictionary = t.get("categories", {})
	for i in n:
		var cat := _weighted(cats, rng)
		if cat == "": break
		_merge(out, roll_category(cat, tier, rng))
	return out

# ------------------------------------------------------------------------------------------------------------------
# records: what a source holds (persisted for containers and corpses, runtime for piles)
# ------------------------------------------------------------------------------------------------------------------
func _store() -> Dictionary:
	var f: Dictionary = Game.state["flags"]
	if not (f.get("loot") is Dictionary): f["loot"] = {}
	return f["loot"]

func _pos_of(node: Node) -> Vector3:
	if node is Node3D: return node.global_position if node.is_inside_tree() else node.position
	return Vector3.ZERO

func key_for(node: Node) -> String:
	var p := _pos_of(node)
	return "%d:%s:%d:%d" % [tide_level(), str(node.get_meta("container", "pile")), int(roundf(p.x)), int(roundf(p.z))]

func _poi_of(node: Node) -> Dictionary:
	var id := str(node.get_meta("poi", ""))
	if id != "" and Game.world != null and Game.world.has_method("poi"): return Game.world.poi(id)
	if Game.world != null and Game.world.has_method("poi_at"):
		var p := _pos_of(node); return Game.world.poi_at(p.x, p.z)
	return {}

func _normalise_entries(items: Array) -> void:
	for e in items:
		e["count"] = int(e.get("count", 1))
		if e.get("inst") is Dictionary:
			match str(e.get("kind", "")):
				"weapon": Inventory._normalise_weapon(e["inst"])
				"mag": Inventory._normalise_mag(e["inst"])
				_:
					e["inst"]["uid"] = int(e["inst"].get("uid", 0)); Inventory._bump(int(e["inst"]["uid"]))
					if e["inst"].has("durability"): e["inst"]["durability"] = float(e["inst"]["durability"])
					if e["inst"].has("charge"): e["inst"]["charge"] = float(e["inst"]["charge"])

## The record for a source node: { items, locked, table, opened, name, key }. Containers and corpses roll on first
## touch and persist in the save; piles keep theirs in meta only.
func record(node: Node) -> Dictionary:
	if node.has_meta("loot") and node.get_meta("loot") is Dictionary: return node.get_meta("loot")
	var kind := str(node.get_meta("container", "pile"))
	var rec := {}
	if kind == "pile":
		rec = { "items": node.get("items") if "items" in node else [], "locked": false, "table": "", "opened": true, "name": str(node.get("label")) if "label" in node else "PILE", "key": "" }
	else:
		var key := key_for(node)
		var store := _store()
		if store.has(key):
			rec = store[key]; _normalise_entries(rec.get("items", []))
		else:
			var poi := _poi_of(node); var poi_kind := str(poi.get("kind", "field"))
			var seed_v := hash(key) ^ int(Game.state.get("seed", 1987))
			var rng := RandomNumberGenerator.new(); rng.seed = seed_v
			var table := table_for(kind, poi_kind, rng)
			var tier := tier_for(poi_kind)
			var items := roll_container(table, tier, poi_kind, rng)
			if kind == "corpse": _dress_corpse(items, node, rng)
			var t: Dictionary = Data.containers.get(table, {})
			var locked := kind in ["locker", "safe"] and rng.randf() < float(t.get("locked", 0.0))
			rec = { "items": items, "locked": locked, "table": table, "opened": false, "name": _display_name(node, kind, table), "key": key, "t": Game.elapsed }
			store[key] = rec
			if store.size() > MAX_RECORDS:
				var oldest := ""; var ot := INF
				for k in store: if float(store[k].get("t", 0.0)) < ot: ot = float(store[k].get("t", 0.0)); oldest = k
				if oldest != "": store.erase(oldest)
	node.set_meta("loot", rec)
	return rec

func _display_name(node: Node, kind: String, table: String) -> String:
	if node.has_meta("name"): return str(node.get_meta("name")).to_upper()
	if kind == "corpse":
		var n: int = int(node.get_meta("explorer", 0))
		return "EXPLORER %d" % n if n > 0 else "EXPLORER"
	if STRUCTURE_NAMES.has(kind): return STRUCTURE_NAMES[kind]
	return str(Data.containers.get(table, {}).get("name", kind)).to_upper()

## An explorer who did not make it back: tags, a letter, the pack's contents, and what they were carrying.
func _dress_corpse(items: Array, node: Node, rng: RandomNumberGenerator) -> void:
	if Data.items.has("dogtag"): _merge(items, { "kind": "item", "id": "dogtag", "count": 1 })
	if Data.items.has("explorer_pack") and rng.randf() < 0.7: _merge(items, { "kind": "item", "id": "explorer_pack", "count": 1 })
	if Data.items.has("documents") and rng.randf() < 0.35: _merge(items, { "kind": "item", "id": "documents", "count": 1 })
	var poi := _poi_of(node); var tier := tier_for(str(poi.get("kind", "forest")))
	if rng.randf() < 0.45: _merge(items, roll_category("weapon", tier, rng))
	if rng.randf() < 0.3: _merge(items, roll_category("armor", tier, rng))
	if rng.randf() < 0.5: _merge(items, roll_category("med", tier, rng))

# ------------------------------------------------------------------------------------------------------------------
# interaction
# ------------------------------------------------------------------------------------------------------------------
func prompt_for(node: Node) -> String:
	var rec := record(node)
	var name := str(rec.get("name", "CRATE"))
	if bool(rec.get("locked", false)):
		if Game.inventory != null and Game.inventory.count("key_locker") > 0: return "[E] UNLOCK · %s" % name
		if Game.inventory != null and Game.inventory.count("lockpick") > 0: return "[E] PICK LOCK · %s · %d TRIES" % [name, Game.inventory.uses_left("lockpick")]
		return "LOCKED · %s" % name
	if bool(rec.get("opened", false)) and rec.get("items", []).is_empty(): return "[E] SEARCH · %s · EMPTY" % name
	return "[E] SEARCH · %s" % name

func _panel_data(node: Node, rec: Dictionary) -> Dictionary:
	var poi := _poi_of(node)
	var kind := str(node.get_meta("container", "pile"))
	var title := str(rec.get("name", "PILE"))
	if not poi.is_empty(): title += " · " + str(poi.get("name", "")).to_upper()
	return { "source": node, "kind": kind, "name": rec.get("name", "PILE"), "title": title, "code": "UNPSC · RECOVERY", "items": rec["items"], "locked": rec.get("locked", false), "table": rec.get("table", "") }

## First interaction rolls the contents (and fights the lock); every interaction opens the loot panel.
func open_container(node: Node) -> bool:
	var rec := record(node)
	if bool(rec.get("locked", false)):
		if not _unlock(node, rec): return false
	if not bool(rec.get("opened", false)):
		rec["opened"] = true
		Audio.play("container_open", _pos_of(node), 0.7)
		container_opened.emit(node, rec)
	Events.open_panel.emit("loot", _panel_data(node, rec))
	return true

func open_pile(node: Node) -> bool:
	var rec := record(node)
	Audio.play("pickup_item", _pos_of(node), 0.4)
	Events.open_panel.emit("loot", _panel_data(node, rec))
	return true

func _unlock(node: Node, rec: Dictionary) -> bool:
	var inv: Inventory = Game.inventory
	var name := str(rec.get("name", ""))
	if inv == null: return false
	if inv.count("key_locker") > 0:
		inv.remove("key_locker", 1); rec["locked"] = false
		Audio.play("lock_open", _pos_of(node), 0.7)
		Events.notice.emit("%s unlocked. Key used." % name.capitalize(), "loot")
		return true
	if inv.count("lockpick") > 0:
		var left := inv.uses_left("lockpick")
		inv.use_charge("lockpick")
		if _rng.randf() < LOCKPICK_CHANCE:
			rec["locked"] = false
			Audio.play("lock_open", _pos_of(node), 0.7)
			Events.notice.emit("%s picked." % name.capitalize(), "loot")
			return true
		Audio.play("lockpick_fail", _pos_of(node), 0.6)
		left -= 1
		Events.notice.emit("Lock holds. %s" % ("%d tr%s left on this pick." % [left, "y" if left == 1 else "ies"] if left > 0 else "Pick broken."), "loot")
		return false
	Audio.play("container_locked", _pos_of(node), 0.6)
	Events.notice.emit("%s locked. Lockpicks or a key required." % name.capitalize(), "loot")
	return false

func contents(node: Node) -> Array: return record(node).get("items", [])

func _grant(e: Dictionary) -> bool:
	var inv: Inventory = Game.inventory
	if inv == null: return false
	match str(e.get("kind", "")):
		"weapon":
			if not (e.get("inst") is Dictionary): return false
			inv.add_weapon(e["inst"]); Audio.play("pickup_weapon", null, 0.6)
		"mag":
			if not (e.get("inst") is Dictionary): return false
			inv.add_mag(e["inst"]); Audio.play("pickup_item", null, 0.5)
		"gear":
			if not (e.get("inst") is Dictionary): return false
			inv.add_gear(e["inst"]); Audio.play("pickup_item", null, 0.5)
		_:
			var id := str(e.get("id", ""))
			if Data.def(id).is_empty(): return false
			inv.add(id, int(e.get("count", 1)))
			Audio.play("pickup_ammo" if Data.ammo.has(id) else "pickup_item", null, 0.5)
			if str(Data.def(id).get("kind", "")) == "artifact":
				Events.artifact_picked.emit(id)
	return true

## Take entry i (or `n` of a stack) from a source into the kit. Returns the entry taken (empty on failure).
func take(node: Node, i: int, n: int = -1) -> Dictionary:
	var rec := record(node); var items: Array = rec.get("items", [])
	if i < 0 or i >= items.size(): return {}
	var e: Dictionary = items[i]
	var out: Dictionary = e
	if str(e.get("kind", "")) == "item" and n > 0 and n < int(e.get("count", 1)):
		out = { "kind": "item", "id": e["id"], "count": n }
		e["count"] = int(e["count"]) - n
	else: items.remove_at(i)
	if not _grant(out):
		return {}
	looted.emit(out, node)
	_after_take(node, rec)
	return out
func take_all(node: Node) -> Array:
	var rec := record(node); var items: Array = rec.get("items", [])
	var taken := []
	while not items.is_empty():
		var e: Dictionary = items[0]; items.remove_at(0)
		if _grant(e): taken.append(e); looted.emit(e, node)
	_after_take(node, rec)
	return taken
## Put something from the kit into a source (a stash in a crate, or dropping into a pile). entry as from Inventory.list().
func put(node: Node, entry: Dictionary, n: int = -1) -> bool:
	var inv: Inventory = Game.inventory
	var rec := record(node); var items: Array = rec.get("items", [])
	match str(entry.get("kind", "")):
		"weapon":
			var w: Variant = inv.remove_weapon(int(entry.get("uid", -1)))
			if w == null: return false
			items.append({ "kind": "weapon", "id": w["id"], "count": 1, "inst": w })
		"mag":
			var m: Variant = inv.remove_mag(int(entry.get("uid", -1)))
			if m == null: return false
			items.append({ "kind": "mag", "id": m["id"], "count": 1, "inst": m })
		_:
			if entry.has("uid"):
				var g: Variant = inv.remove_gear(int(entry["uid"]))
				if g == null: return false
				items.append({ "kind": "gear", "id": g["id"], "count": 1, "inst": g })
			else:
				var id := str(entry.get("id", ""))
				var k := inv.count(id) if n < 0 else mini(n, inv.count(id))
				if k <= 0 or not inv.remove(id, k): return false
				_merge(items, { "kind": "item", "id": id, "count": k })
	if node.has_method("refresh"): node.refresh()
	return true

func _after_take(node: Node, rec: Dictionary) -> void:
	if node.has_method("refresh"): node.refresh()
	if rec.get("items", []).is_empty() and node.has_method("vanish") and str(node.get_meta("container", "pile")) == "pile":
		_piles.erase(node); node.vanish()

# ------------------------------------------------------------------------------------------------------------------
# piles
# ------------------------------------------------------------------------------------------------------------------
func _parent_for_piles() -> Node:
	if Game.world != null and is_instance_valid(Game.world): return Game.world
	var cs := get_tree().current_scene
	return cs if cs != null else self

## Drop a pile of loot entries at pos. kind: mimic | explorer | pile. Returns the pile node.
func spawn_pile(pos: Vector3, items: Array, kind: String = "pile") -> Node:
	var pile: StaticBody3D = load("res://scripts/loot/pile.gd").new()
	pile.kind = kind
	pile.label = { "mimic": "MIMIC", "explorer": "EXPLORER", "pile": "PILE" }.get(kind, kind.to_upper())
	pile.items = items
	pile.name = "Pile_%s_%d" % [kind, Inventory.next_uid()]
	if kind != "explorer": pile.set_meta("container", "pile")
	var parent := _parent_for_piles()
	parent.add_child(pile)
	var y := pos.y
	if Game.world != null and Game.world.has_method("get_height"): y = maxf(y, float(Game.world.get_height(pos.x, pos.z)))
	pile.global_position = Vector3(pos.x, y, pos.z)
	pile.set_meta("loot", { "items": items, "locked": false, "table": "", "opened": true, "name": pile.label, "key": "" })
	if kind != "explorer":
		_piles.append(pile)
		while _piles.size() > MAX_PILES:
			var old: Node = _piles.pop_front()
			if is_instance_valid(old): old.queue_free()
	return pile

## What a dead mimic leaves (MimicLoadout.drops_for) as a pile; entities call this with their loadout.
func spawn_mimic_pile(pos: Vector3, loadout: Dictionary) -> Node:
	var drops := MimicLoadout.drops_for(loadout, _rng)
	if drops.is_empty(): return null
	return spawn_pile(pos, drops, "mimic")

## Drop kit from the inventory panel: entries as from Inventory.list().
func drop(entries: Array, pos: Vector3) -> Node:
	var pile := spawn_pile(pos, [], "pile")
	for e in entries: put(pile, e)
	if contents(pile).is_empty(): pile.queue_free(); return null
	return pile

# ------------------------------------------------------------------------------------------------------------------
# world hooks: containers and explorer corpses
# ------------------------------------------------------------------------------------------------------------------
func _on_game_started(_new_game: bool) -> void:
	for p in _piles: if is_instance_valid(p): p.queue_free()
	_piles.clear()
	_pools.clear()
	for n in get_tree().get_nodes_in_group("loot_piles"): if n.has_meta("container") and str(n.get_meta("container")) != "corpse": n.queue_free()
	call_deferred("_maybe_place", true)
func _on_world_ready() -> void: call_deferred("_maybe_place", false)
func _on_tide(_level: int) -> void:
	Game.state["flags"]["loot"] = {}
	for c in get_tree().get_nodes_in_group("containers"): c.remove_meta("loot")
	for p in _piles: if is_instance_valid(p): p.queue_free()
	_piles.clear()
	_place_corpses(true)
func _maybe_place(force: bool) -> void:
	if Game.mode != "playing" or Game.world == null or not is_instance_valid(Game.world): return
	if not bool(Game.world.get("ready_done")): return
	adopt_containers()
	_place_corpses(force)

## Give every node marked meta "container" (and not scripted by its structure) the container behaviour.
func adopt_containers() -> void:
	var roots := []
	if Game.world != null: roots.append(Game.world)
	var base := get_tree().get_first_node_in_group("base")
	if base != null: roots.append(base)
	for r in roots: _adopt_walk(r, 0)
func register_container(node: Node) -> void:
	if not node.has_meta("container"): node.set_meta("container", "crate")
	if not node.is_in_group("containers"): node.add_to_group("containers")
	if node.get_script() == null:
		node.set_script(load("res://scripts/loot/container.gd"))
	if not node.is_in_group("interactable"): node.add_to_group("interactable")
func _adopt_walk(n: Node, depth: int) -> void:
	if depth > 12: return
	if n.has_meta("container") and not n.is_in_group("loot_piles"): register_container(n)
	for c in n.get_children(): _adopt_walk(c, depth + 1)

func _place_corpses(force: bool) -> void:
	if Game.world == null or not is_instance_valid(Game.world): return
	if not force and not _corpses.is_empty(): return
	for c in _corpses: if is_instance_valid(c): c.queue_free()
	_corpses.clear()
	var i := 0
	for poi in Game.world.pois():
		var kind := str(poi.get("kind", ""))
		if not (kind in CORPSE_POIS): continue
		var rng := RandomNumberGenerator.new(); rng.seed = hash(str(poi.get("id", "")) + ":corpse") ^ (tide_level() * 7919) ^ int(Game.state.get("seed", 1987))
		var pos := _corpse_spot(poi, rng)
		if pos == Vector3.INF: continue
		var pile: StaticBody3D = load("res://scripts/loot/pile.gd").new()
		pile.kind = "explorer"; pile.name = "Explorer_%s" % str(poi.get("id", ""))
		var num: int = CORPSE_NUMBERS[i % CORPSE_NUMBERS.size()]; i += 1
		pile.label = "EXPLORER %d" % num
		pile.set_meta("container", "corpse"); pile.set_meta("poi", str(poi.get("id", ""))); pile.set_meta("explorer", num)
		pile.add_to_group("containers")
		# roll before entering the tree (the record key comes from the position) so the body is built with its gun beside it
		pile.position = pos
		var rec := record(pile)
		pile.items = rec["items"]
		_parent_for_piles().add_child(pile)
		pile.global_position = pos
		_corpses.append(pile)

func _corpse_spot(poi: Dictionary, rng: RandomNumberGenerator) -> Vector3:
	var w: Node = Game.world
	var cx := float(poi.get("x", 0)); var cz := float(poi.get("z", 0)); var r := float(poi.get("r", 30)) * 0.5
	for i in 14:
		var a := rng.randf() * TAU; var d := r * (0.25 + 0.75 * rng.randf())
		var x := cx + cos(a) * d; var z := cz + sin(a) * d
		if w.has_method("in_water") and w.in_water(x, z): continue
		if w.has_method("in_footprint") and w.in_footprint(x, z, 0.8): continue
		var y := float(w.get_height(x, z)) if w.has_method("get_height") else 0.0
		return Vector3(x, y, z)
	return Vector3.INF
