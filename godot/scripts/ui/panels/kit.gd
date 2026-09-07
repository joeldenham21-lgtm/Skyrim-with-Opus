class_name KitView
extends RefCounted
## Shared reading of Inventory entries for the manifest, the search, the locker and the crate: what category a thing
## belongs in, what it weighs, and the two lines of text that name it. Never returns a raw id.

const SLOT_LABEL := { "primary": "Primary", "secondary": "Secondary", "sidearm": "Sidearm", "melee": "Melee",
	"vest": "Vest", "helmet": "Helmet", "backpack": "Pack", "rig": "Rig", "headgear": "Headgear", "mask": "Mask" }
const DOLL := ["helmet", "headgear", "mask", "vest", "rig", "backpack", "primary", "secondary", "sidearm", "melee"]
const GEAR_SLOT := { "vest": "vest", "helmet": "helmet", "backpack": "backpack", "rig": "rig", "headgear": "headgear", "mask": "mask", "melee": "melee" }
const PART_ITEM := { "barrel": "part_barrel", "bolt": "part_bolt", "frame": "part_spring" }
const USE_SOUND := { "bandage": "bandage_use", "hemostat": "bandage_use", "medkit": "medkit_use", "medkit_ai2": "medkit_use",
	"stim": "stim_use", "adrenaline": "stim_use", "morphine": "stim_use", "energy": "stim_use" }

## Manifest section for an entry: weapon mag ammo kit med tools parts attachment artifact mission
static func category(entry: Dictionary) -> String:
	var kind := str(entry.get("kind", ""))
	if kind == "weapon" or kind == "mag": return kind
	var id := str(entry.get("id", ""))
	if Data.ammo.has(id): return "ammo"
	var c := Data.category_of(id)
	match c:
		"armor", "helmet", "pack", "rig", "headgear", "mask": return "kit"
		"med", "food": return "med"
		"grenade", "tool", "melee", "key": return "tools"
		"part", "battery", "filter": return "parts"
	return c

static func entry_weight(entry: Dictionary) -> float:
	var kind := str(entry.get("kind", ""))
	if kind == "weapon" and entry.get("inst") is Dictionary: return Inventory.weapon_weight(entry["inst"])
	if kind == "mag" and entry.get("inst") is Dictionary: return Inventory.mag_weight(entry["inst"])
	return Data.weight_of(str(entry.get("id", "")), int(entry.get("count", 1)))

static func entry_name(entry: Dictionary) -> String:
	var id := str(entry.get("id", ""))
	var d := Data.def(id)
	if str(entry.get("kind", "")) == "weapon": return str(d.get("full", d.get("name", id)))
	return str(d.get("name", id))

static func entry_sub(entry: Dictionary) -> String:
	var kind := str(entry.get("kind", ""))
	var id := str(entry.get("id", ""))
	if kind == "weapon" and entry.get("inst") is Dictionary: return Paper.weapon_sub(entry["inst"])
	if kind == "mag" and entry.get("inst") is Dictionary: return Paper.mag_sub(entry["inst"])
	if entry.get("inst") is Dictionary: return Paper.gear_sub(entry["inst"])
	if Data.ammo.has(id):
		var a: Dictionary = Data.ammo[id]
		var dmg := "%d" % int(a.get("damage", 0))
		if int(a.get("pellets", 1)) > 1: dmg += " × %d" % int(a["pellets"])
		return "%s · damage %s · penetration class %s" % [Paper.cal_short(str(a.get("cal", ""))), dmg, str(a.get("pen", 1))]
	return str(Data.def(id).get("desc", ""))

static func slot_of_uid(inv: Inventory, uid: int) -> String:
	if inv == null: return ""
	for s in inv.equipment.keys():
		var v: Variant = inv.equipment[s]
		if v != null and int(v) == uid: return str(s)
	return ""

## Inventory.list() with ammunition reported as kind "ammo" so the manifest can group it by calibre.
static func entries(inv: Inventory) -> Array:
	if inv == null: return []
	var out: Array = []
	for e in inv.list():
		var d: Dictionary = e.duplicate()
		if Data.ammo.has(str(d.get("id", ""))) and not d.has("uid"): d["kind"] = "ammo"
		out.append(d)
	return out

static func is_gear_entry(entry: Dictionary) -> bool:
	return entry.has("uid") and str(entry.get("kind", "")) != "weapon" and str(entry.get("kind", "")) != "mag"

## Uses left on the open kit (cleaning, repair, armour and lockpicks work through their uses).
static func uses_left(id: String) -> int:
	if Game.inventory == null: return 0
	return Game.inventory.uses_left(id)

static func key_of(entry: Dictionary) -> String:
	return "%s:%s:%s" % [str(entry.get("kind", "")), str(entry.get("id", "")), str(entry.get("uid", ""))]

## Everything the player carries, grouped by manifest category.
static func by_category(inv: Inventory) -> Dictionary:
	var by := {}
	for e in entries(inv):
		var c := category(e)
		if not by.has(c): by[c] = []
		by[c].append(e)
	return by
