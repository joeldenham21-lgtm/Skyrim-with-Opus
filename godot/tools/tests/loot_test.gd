extends SceneTree
## Loot v2 tests: 10 000 rolls per container table and tier with distributions, rarity ordering and rank gating;
## structure kinds by POI; mimic loadouts and drops; locked containers, corpses and piles end to end.
## Run: $GODOT --headless --path . -s tools/tests/loot_test.gd
const N := 10000
var G: Node
var D: Node
var E: Node
var L: Node
var Inv: GDScript
var ML: GDScript
var fails := 0
var checks := 0
var panels: Array = []

func ok(cond: bool, what: String) -> void:
	checks += 1
	if not cond: fails += 1; print("  FAIL: ", what)

func _initialize() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)

func _run() -> void:
	G = root.get_node("Game"); D = root.get_node("Data"); E = root.get_node("Events")
	Inv = load("res://scripts/inventory/inventory.gd"); ML = load("res://scripts/loot/loadout.gd")
	G.state = G.default_state(); G._setup_systems(); G.set_mode("playing")
	L = G.loot
	L._rng.seed = 12345
	E.open_panel.connect(func(name, data): panels.append([name, data]))
	test_tables()
	test_structures_by_poi()
	test_loadouts()
	test_containers_and_piles()
	print("[loot_test] %d checks, %d failures" % [checks, fails])
	quit(1 if fails > 0 else 0)

func _rarity(id: String) -> String: return str(D.def(id).get("rarity", "common"))
func _value(items: Array) -> float:
	# rough sale value of a roll: 40 % of list (artifacts full), rounds counted
	var v := 0.0
	for e in items:
		var d: Dictionary = D.def(str(e["id"]))
		var p := float(d.get("price", 0))
		if str(d.get("kind", "")) == "artifact": v += p * int(e.get("count", 1))
		elif str(e.get("kind", "")) == "weapon": v += p * 0.4 * (0.5 + 0.5 * Inv.condition(e["inst"]))
		else: v += p * 0.4 * int(e.get("count", 1))
	return v

func test_tables() -> void:
	print("[loot_test] %d rolls per table and tier" % N)
	var rng := RandomNumberGenerator.new()
	var summary := {}
	for table in D.containers.keys():
		for tier in [0, 1, 2, 3, 4]:
			rng.seed = hash(table) + tier * 31
			var cats := {}; var rar := { "common": 0, "uncommon": 0, "rare": 0, "epic": 0 }; var ids := {}; var by_cat := {}
			var empty := 0; var entries := 0; var value := 0.0; var rounds := 0; var max_rank := 0; var top_items := 0
			for k in N:
				var items: Array = L.roll_container(table, tier, "", rng)
				if items.is_empty(): empty += 1; continue
				value += _value(items)
				for e in items:
					entries += 1
					var id := str(e["id"]); var d: Dictionary = D.def(id)
					ok(not d.is_empty(), "%s rolled an unknown id %s" % [table, id])
					var cat := str(D.category_of(id)); cats[cat] = int(cats.get(cat, 0)) + 1
					rar[_rarity(id)] = int(rar.get(_rarity(id), 0)) + 1
					if not by_cat.has(cat): by_cat[cat] = {}
					by_cat[cat][id] = int(by_cat[cat].get(id, 0)) + 1
					ids[id] = int(ids.get(id, 0)) + 1
					max_rank = maxi(max_rank, int(d.get("rank", 1)))
					if D.ammo.has(id): rounds += int(e["count"])
					if str(e.get("kind", "")) in ["weapon", "mag", "gear"]:
						ok(e.get("inst") is Dictionary and not e["inst"].is_empty(), "%s: %s entry carries an instance" % [table, e["kind"]])
					if str(e.get("kind", "")) == "weapon":
						var c: float = Inv.condition(e["inst"]) * 100.0
						ok(c >= 20.0 and c <= 95.0, "found weapons are worn (%.0f)" % c); ok(float(e["inst"]["dirt"]) >= 0.25, "found weapons are fouled")
					if str(e.get("kind", "")) == "gear" and D.def(id).get("durability") != null:
						ok(float(e["inst"]["durability"]) <= float(D.def(id)["durability"]), "found armour is damaged or at most new")
			var t: Dictionary = D.containers[table]
			var empty_rate := float(empty) / N
			var rolls: Array = t.get("rolls", [1, 1])
			var zero_roll := (1.0 / float(int(rolls[1]) - int(rolls[0]) + 1)) if int(rolls[0]) == 0 else 0.0
			var allowed := float(t.get("empty", 0.0)) + (1.0 - float(t.get("empty", 0.0))) * zero_roll + 0.03
			ok(empty_rate <= allowed, "%s tier %d: %.0f %% empty (table allows %.0f %%)" % [table, tier, empty_rate * 100, allowed * 100])
			ok(entries > 0, "%s tier %d never yields" % [table, tier])
			# rarity ordering: inside every category, the average common item rolls at least as often as the average
			# uncommon one, and so on down to epic (with a statistical margin)
			for cat in by_cat.keys():
				var avg := {}; var tot := {}
				for id in by_cat[cat].keys():
					var r := _rarity(id)
					avg[r] = float(avg.get(r, 0.0)) + by_cat[cat][id]; tot[r] = int(tot.get(r, 0)) + 1
				for r in avg.keys(): avg[r] = avg[r] / tot[r]
				var order := ["common", "uncommon", "rare", "epic"]
				for k in 3:
					var hi: String = order[k]; var lo: String = order[k + 1]
					if avg.has(hi) and avg.has(lo) and float(avg[lo]) * tot[lo] >= 40.0:
						ok(float(avg[hi]) >= 0.85 * float(avg[lo]), "%s tier %d %s: avg %s item %.1f >= avg %s item %.1f" % [table, tier, cat, hi, avg[hi], lo, avg[lo]])
			ok(rar["rare"] >= rar["epic"], "%s tier %d: rare (%d) >= epic (%d)" % [table, tier, rar["rare"], rar["epic"]])
			# rank gate: nothing more than two grades over the tier, and rank 5 never below tier 3
			var eff_tier := clampi(maxi(tier, int(t.get("tierMin", 0))), 0, 4)
			ok(max_rank <= eff_tier + 2, "%s tier %d: max rank %d" % [table, tier, max_rank])
			summary["%s|%d" % [table, tier]] = { "cats": cats, "rar": rar, "ids": ids, "empty": empty_rate, "value": value / N, "rounds": float(rounds) / N, "entries": float(entries) / N }
	# print the distributions that matter for balance
	for table in D.containers.keys():
		for tier in [1, 3]:
			var s: Dictionary = summary["%s|%d" % [table, tier]]
			var ids: Dictionary = s["ids"]; var keys: Array = ids.keys()
			keys.sort_custom(func(a, b): return ids[a] > ids[b])
			var top := []
			for k in mini(6, keys.size()): top.append("%s %.1f%%" % [keys[k], 100.0 * ids[keys[k]] / maxf(1.0, float(s["entries"]) * N)])
			var r: Dictionary = s["rar"]; var tot := maxf(1.0, float(r["common"] + r["uncommon"] + r["rare"] + r["epic"]))
			print("  %-14s t%d  empty %2.0f%%  entries %.2f  rounds %5.1f  value %6.0f ₽  rarity c/u/r/e %2.0f/%2.0f/%2.0f/%2.0f %%  %s" % [table, tier, s["empty"] * 100, s["entries"], s["rounds"], s["value"], 100 * r["common"] / tot, 100 * r["uncommon"] / tot, 100 * r["rare"] / tot, 100 * r["epic"] / tot, ", ".join(top)])
	# epics climb with the tier
	for table in ["safe", "weapon_crate", "explorer_pack", "armor_locker"]:
		var e1: int = summary["%s|1" % table]["rar"]["epic"]; var e4: int = summary["%s|4" % table]["rar"]["epic"]
		ok(e4 > e1, "%s: epics climb with the tier (%d -> %d)" % [table, e1, e4])
	# rank 5 kit only at the top tiers
	var r5_low := 0; var r5_high := 0
	for key in summary.keys():
		var tier := int(key.split("|")[1])
		for id in summary[key]["ids"].keys():
			if int(D.def(id).get("rank", 1)) >= 5:
				if tier <= 2: r5_low += summary[key]["ids"][id]
				else: r5_high += summary[key]["ids"][id]
	ok(r5_low == 0, "no rank-5 kit at tier <= 2 (%d)" % r5_low); ok(r5_high > 0, "rank-5 kit exists at tier 3-4 (%d)" % r5_high)
	# ammo scarcity: an ammo tin at tier 1 averages well under a full magazine
	var tin: Dictionary = summary["ammo_tin|1"]
	ok(float(tin["rounds"]) > 8.0 and float(tin["rounds"]) < 40.0, "ammo tin averages %.1f rounds" % float(tin["rounds"]))
	# weapons are rare outside weapon crates
	var fl: Dictionary = summary["footlocker|1"]["cats"]
	ok(float(fl.get("weapon", 0)) / N < 0.15, "footlocker weapons: %.1f %% of rolls" % (100.0 * fl.get("weapon", 0) / N))

func test_structures_by_poi() -> void:
	print("[loot_test] structure kinds by POI")
	var rng := RandomNumberGenerator.new(); rng.seed = 7
	for poi_kind in D.containers_by_poi.keys():
		for kind in ["crate", "locker", "safe", "desk", "cabinet", "bag", "corpse", "shelf"]:
			var tables := {}
			for k in 400:
				var t: String = L.table_for(kind, poi_kind, rng)
				ok(D.containers.has(t), "%s at %s -> table %s exists" % [kind, poi_kind, t])
				tables[t] = int(tables.get(t, 0)) + 1
				if k < 50: L.roll_container(kind, L.tier_for(poi_kind), poi_kind, rng)
			if kind in ["crate", "bag"] and poi_kind in ["checkpoint", "convoy", "village"]:
				print("  %-6s at %-10s -> %s" % [kind, poi_kind, str(tables)])
	# tier arithmetic
	G.state["tideLevel"] = 1
	ok(L.tier_for("ridge") == 3 and L.tier_for("marsh") == 0 and L.tier_for("village") == 1, "tiers at tide 1")
	G.state["tideLevel"] = 3
	ok(L.tier_for("ridge") == 4 and L.tier_for("marsh") == 2, "tiers climb with the tide and cap at 4")
	G.state["tideLevel"] = 1

func test_loadouts() -> void:
	print("[loot_test] mimic loadouts and drops")
	var rng := RandomNumberGenerator.new(); rng.seed = 99
	var mix := {}
	for k in 2000:
		var c: String = ML.pick_class("village", 1, rng); mix[c] = int(mix.get(c, 0)) + 1
	ok(int(mix.get("recruit", 0)) > int(mix.get("veteran", 0)), "village at tide 1 is mostly recruits: %s" % str(mix))
	mix = {}
	for k in 2000:
		var c: String = ML.pick_class("ridge", 2, rng); mix[c] = int(mix.get(c, 0)) + 1
	ok(int(mix.get("elite", 0)) > 0 and int(mix.get("recruit", 0)) < 400, "ridge at tide 2 rolls elites: %s" % str(mix))
	for cls in D.mimic_classes.keys():
		var n := 1500; var drops_v := 0.0; var weapons := {}; var armour := 0; var att := 0; var partial := 0; var value := 0.0
		for k in n:
			var lo: Dictionary = ML.roll(cls, 1, rng)
			ok(not lo.is_empty() and lo["weapon"] is Dictionary and not lo["weapon"].is_empty(), "%s carries a weapon" % cls)
			var w: Dictionary = lo["weapon"]
			var c: float = Inv.condition(w) * 100.0
			ok(c >= 30.0 and c <= 85.0, "%s weapon condition %.0f in 30-85" % [cls, c])
			ok(ML.rounds_in_gun(w) >= 1, "%s gun has rounds" % cls)
			weapons[w["id"]] = int(weapons.get(w["id"], 0)) + 1
			if w["attachments"].size() + w["rails"].size() > 0: att += 1
			if not lo["vest"].is_empty(): armour += 1
			if w["mag"] is Dictionary and int(w["mag"]["rounds"]) < int(D.magazines[w["mag"]["id"]]["cap"]): partial += 1
			for a in w["attachments"].values():
				ok(D.attachment_fits(D.attachments[a], D.weapons[w["id"]], w["rails"]), "%s: %s actually fits %s" % [cls, a, w["id"]])
			# the entity reloads from its own spares
			var spares: int = lo["mags"].size()
			while ML.consume_round(w): pass
			ok(ML.rounds_in_gun(w) == 0, "gun runs dry")
			if spares > 0 and ML.best_spare(lo) != null: ok(ML.reload_spare(lo) and ML.rounds_in_gun(w) > 0, "%s reloads from a spare" % cls)
			var drops: Array = ML.drops_for(lo, rng)
			ok(drops.size() >= 1 and drops[0]["kind"] == "weapon", "%s drops its weapon first" % cls)
			value += _value(drops)
		print("  %-10s armour %3.0f%%  attachments %3.0f%%  part-spent mag %3.0f%%  drop value %5.0f ₽  weapons %s" % [cls, 100.0 * armour / n, 100.0 * att / n, 100.0 * partial / n, value / n, str(weapons)])
	var seeker: Dictionary = ML.roll_seeker(rng)
	ok(seeker["weapon"]["id"] == "pkm" and ML.armor_pieces(seeker).size() == 1 and int(ML.armor_pieces(seeker)[0]["def"]["cls"]) == 6, "seeker: PKM and a class 6 suit")

class FakeWorld extends Node3D:
	var ready_done := true
	func get_height(_x: float, _z: float) -> float: return 5.5
	func in_water(_x: float, _z: float) -> bool: return false
	func in_footprint(_x: float, _z: float, _m: float = 0.0) -> bool: return false
	func pois() -> Array: return get_tree().root.get_node("Data").map.get("POIS", [])
	func poi(id: String) -> Dictionary:
		for p in pois(): if str(p.get("id", "")) == id: return p
		return {}
	func poi_at(x: float, z: float) -> Dictionary:
		for p in pois(): if Vector2(x - float(p.x), z - float(p.z)).length() <= float(p.get("r", 0.0)): return p
		return {}

func test_containers_and_piles() -> void:
	print("[loot_test] containers, locks, corpses and piles")
	var i = G.inventory
	var fake_world := FakeWorld.new(); fake_world.name = "World"; root.add_child(fake_world)
	G.world = fake_world
	# a safe at Object 12 (tier 2): almost always locked
	var locked := 0
	for k in 40:
		var safe := StaticBody3D.new(); safe.set_meta("container", "safe"); safe.set_meta("poi", "object12"); safe.position = Vector3(100 + k * 3, 0, 50)
		root.add_child(safe)
		var rec: Dictionary = L.record(safe)
		if rec["locked"]: locked += 1
		ok(rec["table"] == "safe" and rec["key"].begins_with("1:safe:"), "safe record")
		safe.queue_free()
	ok(locked >= 30, "safes are locked 90 %% of the time (%d/40)" % locked)
	var safe := StaticBody3D.new(); safe.set_meta("container", "safe"); safe.set_meta("poi", "object12"); safe.position = Vector3(10, 0, 10); root.add_child(safe)
	var rec: Dictionary = L.record(safe); rec["locked"] = true
	ok(L.prompt_for(safe) == "LOCKED · SAFE", "prompt without tools: %s" % L.prompt_for(safe))
	panels.clear()
	ok(not L.open_container(safe), "will not open without a pick"); ok(panels.is_empty(), "no panel")
	i.add("lockpick", 1)
	ok(L.prompt_for(safe).begins_with("[E] PICK LOCK · SAFE"), "prompt with picks: %s" % L.prompt_for(safe))
	var tries := 0; var opened := false
	L._rng.seed = 3
	while i.count("lockpick") > 0 and not opened:
		tries += 1; opened = L.open_container(safe)
	ok(opened or i.count("lockpick") == 0, "either picked or the pick is spent after 3 tries (%d tries)" % tries)
	if not opened:
		i.add("key_locker", 1); ok(L.prompt_for(safe) == "[E] UNLOCK · SAFE", "key prompt"); opened = L.open_container(safe); ok(i.count("key_locker") == 0, "key consumed")
	ok(opened and not rec["locked"] and rec["opened"], "safe open")
	ok(panels.size() == 1 and panels[0][0] == "loot" and panels[0][1]["source"] == safe and panels[0][1]["kind"] == "safe", "loot panel opened with the source")
	ok(str(panels[0][1]["title"]).begins_with("SAFE · "), "title carries the POI: %s" % panels[0][1]["title"])
	var n_items: int = rec["items"].size()
	# persistence: the record survives a save/load, and reopening does not re-roll
	var before := JSON.stringify(rec["items"])
	ok(G.state["flags"]["loot"].has(rec["key"]), "record stored in flags")
	safe.remove_meta("loot")
	var rec2: Dictionary = L.record(safe)
	ok(JSON.stringify(rec2["items"]) == before, "same contents on a second look")
	# take one, take all
	var money0: int = i.money(); var w0: int = i.weapons.size()
	if n_items > 0:
		var e: Dictionary = L.take(safe, 0)
		ok(not e.is_empty(), "took %s" % str(e.get("id"))); ok(rec2["items"].size() == n_items - 1, "one fewer in the safe")
		var taken: Array = L.take_all(safe)
		ok(rec2["items"].is_empty() and taken.size() == n_items - 1, "emptied")
		ok(L.prompt_for(safe).ends_with("· EMPTY"), "empty prompt: %s" % L.prompt_for(safe))
	# put something back
	ok(L.put(safe, { "kind": "item", "id": "probe", "count": 6 }, 2), "stash two probes in the safe"); ok(i.count("probe") == 4 and rec2["items"].size() == 1, "probes moved")
	safe.queue_free()
	# a crate with an unscripted node adopts the container behaviour
	var crate := StaticBody3D.new(); crate.set_meta("container", "crate"); crate.set_meta("poi", "checkpoint"); crate.position = Vector3(-40, 0, 80); root.add_child(crate)
	L.register_container(crate)
	ok(crate.is_in_group("interactable") and crate.has_method("prompt") and crate.has_method("interact"), "adopted container is interactable")
	ok(str(crate.prompt()).begins_with("[E] SEARCH · CRATE"), "crate prompt: %s" % crate.prompt())
	panels.clear(); crate.interact(null); ok(panels.size() == 1, "interact opens the panel")
	crate.queue_free()
	# mimic pile: the gun on top, partial mags, its armour sometimes
	var rng := RandomNumberGenerator.new(); rng.seed = 5
	var lo: Dictionary = ML.roll("veteran", 2, rng)
	var pile: Node = L.spawn_mimic_pile(Vector3(5, 0, 5), lo)
	ok(pile != null and pile.is_inside_tree() and pile.is_in_group("interactable"), "pile spawned")
	ok(pile.prompt() == "[E] SEARCH · MIMIC", "pile prompt: %s" % pile.prompt())
	ok(pile.get_child_count() >= 3, "pile has meshes and a collider (%d children)" % pile.get_child_count())
	var pw := 0
	for e in L.contents(pile): if e["kind"] == "weapon": pw += 1
	ok(pw == 1, "one weapon in the pile")
	var taken: Array = L.take_all(pile)
	ok(i.weapons.size() == w0 + 1, "the mimic's rifle is in the kit"); ok(taken.size() >= 2, "took %d entries" % taken.size())
	await process_frame; await process_frame
	ok(not is_instance_valid(pile), "empty pile is gone")
	# dropped kit pile from the player
	var e2 := { "kind": "item", "id": "probe", "count": 4 }
	var drop: Node = L.drop([e2], Vector3(6, 0, 6))
	ok(drop != null and i.count("probe") == 0 and L.contents(drop).size() == 1, "dropped probes lie in a pile")
	drop.queue_free()
	# explorer corpses: one at each of the listed POIs, with tags and effects
	L._place_corpses(true)
	ok(L._corpses.size() == 5, "five explorers lie in the zone (%d)" % L._corpses.size())
	var tags := 0
	for c in L._corpses:
		var r: Dictionary = L.record(c)
		ok(c.is_in_group("interactable") and str(c.prompt()).begins_with("[E] SEARCH · EXPLORER"), "corpse prompt: %s" % c.prompt())
		for e in r["items"]: if e["id"] == "dogtag": tags += 1
		ok(r["items"].size() >= 3, "%s carries %d things" % [c.name, r["items"].size()])
	ok(tags == 5, "every explorer has a tag")
	# the Tide re-rolls everything
	var key0: String = L.record(L._corpses[0])["key"]
	G.state["tideLevel"] = 2
	E.tide.emit(2)
	ok(G.state["flags"]["loot"].is_empty() or not G.state["flags"]["loot"].has(key0), "records cleared by the Tide")
	ok(L._corpses.size() == 5 and L.record(L._corpses[0])["key"].begins_with("2:"), "corpses re-placed for tide 2")
	G.state["tideLevel"] = 1
