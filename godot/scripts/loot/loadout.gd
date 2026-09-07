class_name MimicLoadout
extends RefCounted
## Mimic loadouts (GEAR.md §6/§8): a mimic is what it carries. The class table (data/mimic_classes.json) is rolled into
## real inventory instances (a worn weapon with a part-spent magazine, spare magazines, a vest, a helmet, grenades, a
## pocket item) so the entity fires exactly what it drops.
##   pick_class(poi_kind, tide)     class name from class_mix[min(4, tide + poi_tier[poi_kind])]
##   roll(class_name, tide)         { cls, def, weapon, mags, vest, helmet, grenades, grenade_id, items, loose, ammo_id, tide }
##   drops_for(loadout)             loot pile entries [{ kind: weapon|mag|gear|item, inst?, id, count }]
##   rounds_in_gun / consume_round / best_spare / reload_spare for the entity's own reloads.
const CLASS_RANK := { "recruit": 0, "regular": 1, "shotgunner": 2, "gunner": 2, "veteran": 3, "sniper": 3, "elite": 4 }

static func class_rank(cls: String) -> int: return int(CLASS_RANK.get(cls, 1))

static func _pick(arr: Array, rng: RandomNumberGenerator) -> Variant:
	if arr.is_empty(): return null
	return arr[rng.randi_range(0, arr.size() - 1)]

static func _ammo_of(cal: String) -> Array:
	var out := []
	for a in Data.ammo.values(): if str(a.get("cal", "")) == cal: out.append(a)
	return out

## The better the mimic, the better the rounds.
static func preferred_ammo(cls: String, cal: String, rng: RandomNumberGenerator) -> String:
	var base := Data.default_ammo(cal)
	var ap := ""; var hp := ""
	for a in _ammo_of(cal):
		if str(a.get("kind", "")) == "ap" and ap == "": ap = str(a["id"])
		if str(a.get("kind", "")) == "hp" and hp == "": hp = str(a["id"])
	match cls:
		"sniper":
			if cal == "7.62x54": return "754_snb" if rng.randf() < 0.6 else ("754_ap" if rng.randf() < 0.5 else base)
			return ap if (ap != "" and rng.randf() < 0.5) else base
		"elite": return ap if (ap != "" and rng.randf() < 0.5) else base
		"veteran": return ap if (ap != "" and rng.randf() < 0.3) else base
		"gunner": return "545_tr" if (cal == "5.45x39" and rng.randf() < 0.35) else base
		"shotgunner": return "12_slug" if rng.randf() < 0.3 else "12_buck"
		"regular": return hp if (hp != "" and rng.randf() < 0.15) else base
	return base

## Class by POI kind and tide level, weighted by class_mix; unknown POI kinds count as tier 1.
static func pick_class(poi_kind: String, tide: int = 1, rng: RandomNumberGenerator = null) -> String:
	if rng == null: rng = RandomNumberGenerator.new(); rng.randomize()
	var tier := clampi(tide + int(Data.poi_tier.get(poi_kind, 1)), 1, 4)
	var mix: Dictionary = Data.class_mix.get(str(tier), Data.class_mix.get("1", { "regular": 1.0 }))
	var sum := 0.0
	for k in mix: sum += float(mix[k])
	var r := rng.randf() * sum
	for k in mix:
		r -= float(mix[k])
		if r <= 0.0: return str(k)
	return "regular"

## Attachments roll in dependency order (rails first) so a light or grip that needs a rail can actually mount.
static func _roll_attachments(weapon: Dictionary, table: Dictionary, rng: RandomNumberGenerator) -> void:
	if table.is_empty(): return
	var ids: Array = table.keys()
	ids.sort_custom(func(a, b): return str(Data.attachments.get(a, {}).get("slot", "")) == "rail" and str(Data.attachments.get(b, {}).get("slot", "")) != "rail")
	for id in ids:
		if rng.randf() >= float(table[id]): continue
		var a: Dictionary = Data.attachments.get(id, {})
		if a.is_empty(): continue
		if str(a.get("slot", "")) == "under" and not Inventory.attach(weapon, str(id)):
			var mounts: Dictionary = Data.weapons.get(str(weapon["id"]), {}).get("mounts", {})
			if str(mounts.get("under", "")) == "akhg" and Inventory.attach(weapon, "rail_akhg"): Inventory.attach(weapon, str(id))
			continue
		Inventory.attach(weapon, str(id))

static func roll(cls: String = "regular", tide: int = 1, rng: RandomNumberGenerator = null) -> Dictionary:
	if rng == null: rng = RandomNumberGenerator.new(); rng.randomize()
	if not Data.mimic_classes.has(cls): cls = "regular"
	var c: Dictionary = Data.mimic_classes.get(cls, {})
	if c.is_empty(): return {}
	var pool := []
	for id in c.get("weapons", []): if Data.weapons.has(str(id)): pool.append(str(id))
	var weapon_id := str(_pick(pool, rng)) if not pool.is_empty() else "akm"
	var wdef: Dictionary = Data.weapons[weapon_id]
	var cal := str(wdef.get("cal", ""))
	var ammo_id := preferred_ammo(cls, cal, rng)
	if not Data.ammo.has(ammo_id): ammo_id = Data.default_ammo(cal)
	var weapon := Inventory.make_weapon(weapon_id, { "condition": roundf(rng.randf_range(30.0, 85.0)), "ammo": ammo_id })
	weapon["dirt"] = rng.randf_range(0.1, 0.6)
	_roll_attachments(weapon, c.get("attachments", {}), rng)
	# the magazine in the gun is part spent: it has been used
	if weapon.get("mag") is Dictionary:
		var cap := int(Data.magazines.get(str(weapon["mag"]["id"]), {}).get("cap", 1))
		weapon["mag"]["rounds"] = maxi(1, int(roundf(cap * rng.randf_range(0.35, 1.0)))); weapon["mag"]["ammo"] = ammo_id
	elif weapon.get("tube", []).size() > 0:
		var keep := maxi(1, int(roundf(weapon["tube"].size() * rng.randf_range(0.5, 1.0))))
		weapon["tube"].resize(keep)
	# spare magazines: 1-4, some part empty; tube and clip guns carry loose rounds instead
	var mags := []; var loose := 0
	var spare := clampi(rng.randi_range(1, int(c.get("mags", 2))), 1, 4)
	var dm: Variant = wdef.get("defaultMag")
	if dm != null and not bool(wdef.get("clip", false)):
		var cap := int(Data.magazines.get(str(dm), {}).get("cap", 1))
		for i in spare: mags.append(Inventory.make_mag(str(dm), ammo_id, maxi(1, int(roundf(cap * rng.randf_range(0.2, 0.8)))) if rng.randf() < 0.3 else cap))
	elif dm != null:
		var cap := int(Data.magazines.get(str(dm), {}).get("cap", 1))
		for i in spare: mags.append(Inventory.make_mag(str(dm), ammo_id, cap))
		loose = rng.randi_range(0, 10)
	else: loose = rng.randi_range(6, 8 + spare * 5)
	# armour (a null in the class list means none)
	var vest_id: Variant = _pick(c.get("armor", []), rng); var helm_id: Variant = _pick(c.get("helmet", []), rng)
	var vest := {}; var helmet := {}
	if vest_id != null and not Data.def(str(vest_id)).is_empty():
		vest = Inventory.make_gear(str(vest_id), { "durability": roundf(float(Data.def(str(vest_id)).get("durability", 60)) * rng.randf_range(0.45, 1.0)) })
	if helm_id != null and not Data.def(str(helm_id)).is_empty():
		helmet = Inventory.make_gear(str(helm_id), { "durability": roundf(float(Data.def(str(helm_id)).get("durability", 50)) * rng.randf_range(0.5, 1.0)) })
	# grenades: the class value is the chance of carrying; a lucky roll carries two
	var g := float(c.get("grenades", 0))
	var grenades := 0
	if g > 0.0 and rng.randf() < g: grenades = 2 if rng.randf() < g * 0.5 else 1
	var grenade_id := "gr_rgd5"
	if cls == "elite": grenade_id = "gr_f1" if rng.randf() < 0.5 else "gr_rgn"
	elif cls == "veteran" and rng.randf() < 0.4: grenade_id = "gr_f1"
	if not Data.items.has(grenade_id): grenade_id = "gr_rgd5"
	# one item from the class drop list, kept in the pockets
	var items := []
	var drops: Array = c.get("drops", [])
	if not drops.is_empty():
		var id := str(_pick(drops, rng))
		if not Data.def(id).is_empty(): items.append(id)
	return { "cls": cls, "def": c, "weapon": weapon, "mags": mags, "vest": vest, "helmet": helmet, "grenades": grenades, "grenade_id": grenade_id,
		"items": items, "loose": loose, "ammo_id": ammo_id, "tide": tide, "hp": float(c.get("hp", 90)), "accuracy": float(c.get("accuracy", 1.0)), "role": str(c.get("role", "")) }

## The seeker's kit: class 6 armour, a PKM, and its own drop list.
static func roll_seeker(rng: RandomNumberGenerator = null) -> Dictionary:
	if rng == null: rng = RandomNumberGenerator.new(); rng.randomize()
	var s: Dictionary = Data.seeker
	var wid := str(_pick(s.get("weapons", ["pkm"]), rng))
	var weapon := Inventory.make_weapon(wid, { "condition": roundf(rng.randf_range(55.0, 90.0)) })
	var drops := []
	for id in s.get("drops", []): if not Data.def(str(id)).is_empty() and rng.randf() < 0.6: drops.append(str(id))
	return { "cls": "seeker", "def": s, "weapon": weapon, "mags": [Inventory.make_mag(str(Data.weapons.get(wid, {}).get("defaultMag", "mag_pkm100")), Data.default_ammo("7.62x54"), 100)],
		"vest": {}, "helmet": {}, "grenades": 0, "grenade_id": "gr_f1", "items": drops, "loose": rng.randi_range(20, 60), "ammo_id": Data.default_ammo("7.62x54"), "tide": 1,
		"hp": float(s.get("hp", 700)), "accuracy": 1.0, "role": "seeker", "cls_armor": int(s.get("cls", 6)) }

## Loot pile entries from what is left when the mimic folds: the weapon with its current magazine, spare mags, its
## armour 40 % of the time, one class drop 50 % of the time, grenades, and the loose rounds it carried.
static func drops_for(loadout: Dictionary, rng: RandomNumberGenerator = null) -> Array:
	var out := []
	if loadout.is_empty(): return out
	if rng == null: rng = RandomNumberGenerator.new(); rng.randomize()
	var w: Variant = loadout.get("weapon")
	if w is Dictionary and not w.is_empty(): out.append({ "kind": "weapon", "inst": w, "id": w["id"], "count": 1 })
	for m in loadout.get("mags", []): if m is Dictionary and not m.is_empty(): out.append({ "kind": "mag", "inst": m, "id": m["id"], "count": 1 })
	if rng.randf() < 0.4:
		for k in ["vest", "helmet"]:
			var g: Variant = loadout.get(k)
			if g is Dictionary and not g.is_empty(): out.append({ "kind": "gear", "inst": g, "id": g["id"], "count": 1 })
	var items: Array = loadout.get("items", [])
	if loadout.get("cls") == "seeker":
		for id in items: out.append({ "kind": "item", "id": str(id), "count": 1 })
	elif not items.is_empty() and rng.randf() < 0.5: out.append({ "kind": "item", "id": str(items[0]), "count": 1 })
	if int(loadout.get("grenades", 0)) > 0: out.append({ "kind": "item", "id": str(loadout.get("grenade_id", "gr_rgd5")), "count": int(loadout["grenades"]) })
	var loose := int(loadout.get("loose", 0)) + rng.randi_range(0, 6)
	var ammo_id := str(loadout.get("ammo_id", ""))
	if loose > 0 and Data.ammo.has(ammo_id): out.append({ "kind": "item", "id": ammo_id, "count": loose })
	return out

## Rounds currently in the gun (magazine or tube plus a chambered round).
static func rounds_in_gun(w: Dictionary) -> int:
	if w.is_empty(): return 0
	return Inventory.rounds_in(w)
## Take one round out of the gun; false when it was empty.
static func consume_round(w: Dictionary) -> bool:
	if w.is_empty(): return false
	var mag: Variant = w.get("mag")
	if mag is Dictionary and int(mag.get("rounds", 0)) > 0:
		mag["rounds"] = int(mag["rounds"]) - 1
		w["chamber"] = mag.get("ammo") if int(mag["rounds"]) > 0 else null
		return true
	var tube: Array = w.get("tube", [])
	if tube.size() > 0:
		tube.pop_back()
		w["chamber"] = tube[tube.size() - 1] if tube.size() > 0 else null
		return true
	if w.get("chamber") != null:
		w["chamber"] = null
		return true
	return false
## The spare magazine with the most rounds, or null.
static func best_spare(loadout: Dictionary) -> Variant:
	var best: Variant = null
	for m in loadout.get("mags", []):
		if int(m.get("rounds", 0)) > 0 and (best == null or int(m["rounds"]) > int(best["rounds"])): best = m
	return best
## Swap the spare into the gun (the empty one goes back to the pouches): true when a reload happened.
static func reload_spare(loadout: Dictionary) -> bool:
	var w: Dictionary = loadout.get("weapon", {})
	var spare: Variant = best_spare(loadout)
	if w.is_empty() or spare == null: return false
	var mags: Array = loadout.get("mags", [])
	mags.erase(spare)
	if w.get("mag") is Dictionary: mags.append(w["mag"])
	w["mag"] = spare
	w["chamber"] = spare.get("ammo")
	return true
## Armour pieces for Data.resolve_hit.
static func armor_pieces(loadout: Dictionary) -> Array:
	var out := []
	for k in ["helmet", "vest"]:
		var g: Variant = loadout.get(k)
		if g is Dictionary and not g.is_empty():
			var d := Data.def(str(g["id"]))
			if not d.is_empty(): out.append({ "def": d, "inst": g, "slot": k })
	if loadout.has("cls_armor"):
		out.append({ "def": { "id": "seeker_suit", "name": "Seeker suit", "cls": int(loadout["cls_armor"]), "zones": ["head", "torso", "stomach", "arms", "legs"], "durability": 400.0 }, "inst": loadout, "slot": "suit" })
	return out
