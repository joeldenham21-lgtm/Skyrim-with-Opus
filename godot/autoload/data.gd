extends Node
## The catalogue. Loaded from data/*.json (exported from the design tables). def(id) finds any item; helpers mirror the browser build.
var calibers := {}
var ammo := {}
var magazines := {}
var weapons := {}
var attachments := {}
var armor := {}
var items := {}
var mimic_classes := {}
var class_mix := {}
var poi_tier := {}
var seeker := {}
var containers := {}
var containers_by_poi := {}
var ammo_roll := {}
var ranks := {}
var map := {}
const ZONE_MULT := { "head": 1.9, "torso": 1.0, "stomach": 0.9, "arms": 0.55, "legs": 0.6 }

func _ready() -> void:
	calibers = _load("calibers"); ammo = _load("ammo"); magazines = _load("magazines"); weapons = _load("weapons")
	attachments = _load("attachments"); armor = _load("armor"); items = _load("items")
	mimic_classes = _load("mimic_classes"); class_mix = _load("class_mix"); poi_tier = _load("poi_tier"); seeker = _load("seeker")
	containers = _load("containers"); containers_by_poi = _load("containers_by_poi"); ammo_roll = _load("ammo_roll"); ranks = _load("ranks"); map = _load("map")
	for id in weapons: weapons[id]["kind"] = "weapon"
	for id in ammo: ammo[id]["kindOf"] = "ammo"
	print("[Data] %d weapons, %d rounds, %d mags, %d attachments, %d armour, %d items" % [weapons.size(), ammo.size(), magazines.size(), attachments.size(), armor.size(), items.size()])

func _load(name: String) -> Dictionary:
	var path := "res://data/%s.json" % name
	if not FileAccess.file_exists(path):
		push_warning("[Data] missing %s" % path); return {}
	var txt := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(txt)
	return parsed if parsed is Dictionary else {}

func def(id: String) -> Dictionary:
	if id == "": return {}
	for table in [weapons, ammo, magazines, attachments, armor, items]:
		if table.has(id): return table[id]
	return {}
func name_of(id: String) -> String: var d := def(id); return d.get("name", id)
func weight_of(id: String, n: int = 1) -> float: return float(def(id).get("weight", 0.0)) * n
func price_of(id: String) -> int: return int(def(id).get("price", 0))
func rank_of(id: String) -> int: return int(def(id).get("rank", 1))
func category_of(id: String) -> String:
	if weapons.has(id): return "weapon"
	if ammo.has(id): return "ammo"
	if magazines.has(id): return "mag"
	if attachments.has(id): return "attachment"
	if armor.has(id):
		var k: String = armor[id].get("kind", "")
		return "armor" if k == "vest" else ("helmet" if k == "helmet" else ("pack" if k == "backpack" else k))
	if items.has(id): return items[id].get("kind", "item")
	return "unknown"
func default_ammo(cal: String) -> String:
	const D := { "9x18": "9x18_fmj", "9x19": "9x19_fmj", "7.62x25": "762x25_fmj", ".45": "45_fmj", "5.45x39": "545_fmj", "7.62x39": "762_fmj", "5.56x45": "556_fmj", "9x39": "939_sp5", "7.62x54": "754_fmj", "12ga": "12_buck" }
	return D.get(cal, "")
func mags_for(weapon_id: String) -> Array:
	var w := weapons.get(weapon_id, {}); var out := []
	if w.is_empty(): return out
	for m in magazines.values(): if w["family"] in m["fits"]: out.append(m)
	return out
func effective_mounts(weapon_def: Dictionary, rails: Array) -> Dictionary:
	var m: Dictionary = weapon_def.get("mounts", {}).duplicate()
	for rid in rails:
		var r := attachments.get(rid, {})
		if r.has("gives"): m.merge(r["gives"], true)
	return m
func attachment_fits(att: Dictionary, weapon_def: Dictionary, rails: Array) -> bool:
	if att.get("slot") == "rail":
		for f in att["fits"]: if f in weapon_def.get("mounts", {}).values(): return true
		return false
	var std: Variant = effective_mounts(weapon_def, rails).get(att.get("slot"), null)
	return std != null and std in att["fits"]
func shop_items(rank: int) -> Array:
	var out := []
	for table in [weapons, ammo, magazines, attachments, armor, items]:
		for d in table.values():
			if d.get("hidden", false): continue
			if int(d.get("rank", 1)) > rank or int(d.get("price", 0)) <= 0: continue
			var k: String = d.get("kind", "")
			if k in ["mission", "key", "artifact"]: continue
			out.append(d)
	return out
func rank_for(earned: int, missions: int) -> int:
	var r := 1
	for k in ranks.values(): if earned >= int(k["earned"]) and missions >= int(k["missions"]): r = max(r, int(k["rank"]))
	return r
## Hit resolution shared by the player and entities. armour_pieces: [{ "def": Dictionary, "inst": Dictionary }]
func resolve_hit(ammo_def: Dictionary, zone: String, armour_pieces: Array, mult: float = 1.0, roll: float = -1.0) -> Dictionary:
	var dmg: float = float(ammo_def.get("damage", 10)) * ZONE_MULT.get(zone, 1.0) * mult
	var pen: float = float(ammo_def.get("pen", 1.0))
	var piece := {}
	for p in armour_pieces:
		if p.has("def") and zone in p["def"].get("zones", []): piece = p; break
	if piece.is_empty(): return { "damage": dmg, "penetrated": true, "armor_hit": {}, "armor_damage": 0.0, "blunt": false }
	var maxd: float = float(piece["def"].get("durability", 1.0))
	var dur: float = clampf(float(piece.get("inst", {}).get("durability", maxd)) / maxd, 0.0, 1.0)
	var eff_class: float = float(piece["def"].get("cls", 1)) * (0.55 + 0.45 * dur)
	var x: float = (pen - eff_class + 1.0) / 2.0
	var p: float = 0.0 if x <= 0.0 else (1.0 if x >= 1.0 else x * x * (3.0 - 2.0 * x))
	var r: float = randf() if roll < 0.0 else roll
	if r < p: return { "damage": dmg * 0.85, "penetrated": true, "armor_hit": piece, "armor_damage": maxf(1.0, dmg * 0.25), "blunt": false }
	var blunt: float = dmg * 0.35 if ammo_def.get("blunt", false) else dmg * (0.12 + 0.08 * maxf(0.0, pen - eff_class + 1.0))
	return { "damage": blunt, "penetrated": false, "armor_hit": piece, "armor_damage": maxf(2.0, dmg * 0.7), "blunt": true }
func zone_from_hit(h01: float, lateral01: float) -> String:
	if h01 > 0.86: return "head"
	if h01 > 0.62: return "arms" if lateral01 > 0.72 else "torso"
	if h01 > 0.48: return "arms" if lateral01 > 0.75 else "stomach"
	return "legs"
