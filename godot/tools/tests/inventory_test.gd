extends SceneTree
## Inventory v2, damage model and kit logic tests. Run: $GODOT --headless --path . -s tools/tests/inventory_test.gd
## (autoload names cannot be referenced at compile time from a -s script, so autoloads are fetched from the root).
var G: Node
var D: Node
var E: Node
var Inv: GDScript
var fails := 0
var checks := 0
var _save_backup: Variant = null

class FakePlayer extends Node3D:
	var alive := true
	var in_base := false
	var yaw := 0.0
	var weapons: Node = null
	var dmg: Node = null
	var kit: Node = null
	var hp_ref: Callable
	var damaged: Array = []
	func look_dir() -> Vector3: return Vector3.FORWARD
	func damage(amount: float, info: Dictionary = {}) -> void:
		var st: Dictionary = get_tree().root.get_node("Game").state
		st["hp"] = maxf(0.0, float(st["hp"]) - amount)
		damaged.append({ "amount": amount, "info": info })
		get_tree().root.get_node("Events").player_damaged.emit(amount, info)
	func heal(v: float) -> void:
		var st: Dictionary = get_tree().root.get_node("Game").state
		st["hp"] = minf(100.0, float(st["hp"]) + v)
	func stop_bleeding() -> void: get_tree().root.get_node("Game").state["bleeding"] = false
	func add_stamina(v: float) -> void:
		var st: Dictionary = get_tree().root.get_node("Game").state
		st["stamina"] = clampf(float(st["stamina"]) + v, 0.0, 100.0)

func ok(cond: bool, what: String) -> void:
	checks += 1
	if not cond:
		fails += 1
		print("  FAIL: ", what)
func eq(a: Variant, b: Variant, what: String) -> void:
	checks += 1
	if a != b:
		fails += 1
		print("  FAIL: %s (got %s, want %s)" % [what, str(a), str(b)])
func near(a: float, b: float, tol: float, what: String) -> void:
	checks += 1
	if absf(a - b) > tol:
		fails += 1
		print("  FAIL: %s (got %.3f, want %.3f)" % [what, a, b])

func _initialize() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)

func _run() -> void:
	G = root.get_node("Game"); D = root.get_node("Data"); E = root.get_node("Events")
	Inv = load("res://scripts/inventory/inventory.gd")
	var save_path: String = G.SAVE_PATH
	if FileAccess.file_exists(save_path): _save_backup = FileAccess.get_file_as_string(save_path)
	var player := FakePlayer.new(); player.name = "Player"; root.add_child(player)
	G.player = player
	G.state = G.default_state()
	G._setup_systems()
	G.set_mode("playing")
	test_starter_kit()
	test_stackables_and_ammo()
	test_mags()
	test_attachments()
	test_weight()
	test_armor_and_hits()
	test_damage_and_kit()
	test_quick_and_transfer()
	test_save_load()
	# restore whatever save the machine had
	if _save_backup != null:
		var f := FileAccess.open(save_path, FileAccess.WRITE); f.store_string(_save_backup)
	elif FileAccess.file_exists(save_path): DirAccess.remove_absolute(save_path)
	print("[inventory_test] %d checks, %d failures" % [checks, fails])
	quit(1 if fails > 0 else 0)

func inv():
	return G.inventory

func test_starter_kit() -> void:
	print("[inventory_test] starter kit")
	var i = inv()
	eq(i.weapons.size(), 1, "one weapon"); eq(str(i.weapons[0]["id"]), "pm", "it is the PM")
	eq(i.mags.size(), 2, "two magazines"); eq(i.ready_mags.size(), 2, "both in the belt pouches")
	eq(i.gear.size(), 4, "rig, pack, knife, torch")
	eq(i.count("bandage"), 2, "bandages"); eq(i.count("probe"), 6, "probes"); eq(i.count("battery"), 1, "a cell"); eq(i.count("9x18_fmj"), 16, "loose 9x18"); eq(i.count("cigarettes"), 1, "cigarettes")
	eq(int(i.equipment["sidearm"]), int(i.weapons[0]["uid"]), "PM in the sidearm slot")
	ok(i.equipped_def("rig").get("id") == "rig_belt", "belt pouches worn"); ok(i.equipped_def("backpack").get("id") == "pack_tortilla", "daypack worn"); ok(i.equipped_def("melee").get("id") == "knife", "knife in the melee slot")
	eq(str(i.quick[0]), "bandage", "bandage on key 6")
	var pm: Dictionary = i.weapons[0]
	eq(Inv.rounds_in(pm), 9, "PM loaded 8 + 1"); eq(str(pm["chamber"]), "9x18_fmj", "chambered"); eq(str(pm["fireMode"]), "semi", "semi")
	near(Inv.condition(pm), 1.0, 0.001, "new weapon condition")
	var toz: Dictionary = Inv.make_weapon("toz")
	eq(toz["tube"].size(), 2, "break-open TOZ holds two shells"); ok(toz["chamber"] == null, "no separate chamber on a break-open")
	var mosin: Dictionary = Inv.make_weapon("mosin")
	eq(mosin["tube"].size(), 4, "Mosin tube 4"); eq(str(mosin["chamber"]), "754_fmj", "Mosin chambered"); eq(Inv.rounds_in(mosin), 5, "Mosin 5 rounds")
	var akm: Dictionary = Inv.make_weapon("akm", { "condition": 55, "loaded": false, "ammo": "762_ap" })
	ok(akm["mag"] == null and akm["chamber"] == null, "unloaded AKM"); near(float(akm["parts"]["bolt"]), 55.0, 0.01, "condition applied")
	ok(Inv.make_weapon("nonsense").is_empty(), "unknown weapon gives {}")

func test_stackables_and_ammo() -> void:
	print("[inventory_test] stackables and ammunition")
	var i = inv()
	eq(i.add("bandage", 3), 5, "add stacks"); ok(i.has("bandage", 5), "has 5"); ok(not i.has("bandage", 6), "not 6")
	ok(i.remove("bandage", 5), "remove all"); eq(i.count("bandage"), 0, "gone"); ok(not i.items.has("bandage"), "key erased")
	ok(not i.remove("bandage", 1), "cannot remove what is not there")
	i.add("bandage", 2)
	eq(i.add_ammo("9x18", 10), 26, "add_ammo by calibre goes to the default type"); eq(i.ammo_count("9x18"), 26, "count by calibre")
	i.add_ammo("9x18_hp", 12)
	eq(i.ammo_count("9x18"), 38, "calibre sums types"); eq(i.ammo_count("9x18_hp"), 12, "count by id")
	var types: Array = i.ammo_types_of("9x18"); ok("9x18_fmj" in types and "9x18_hp" in types, "types of 9x18")
	eq(i.preferred_ammo("9x18"), "9x18_fmj", "first carried type preferred by default")
	i.set_preferred_ammo("9x18", "9x18_hp"); eq(i.preferred_ammo("9x18"), "9x18_hp", "preference honoured")
	eq(i.take_ammo("9x18_hp", 20), 12, "take_ammo caps at carried"); eq(i.preferred_ammo("9x18"), "9x18_fmj", "preference falls back when empty")
	eq(i.preferred_ammo("7.62x39"), "762_fmj", "default type when none carried")
	# stackables with uses: a lockpick is worked through three tries
	i.add("lockpick", 1)
	eq(i.uses_left("lockpick"), 3, "three tries"); ok(i.use_charge("lockpick"), "try 1"); ok(i.use_charge("lockpick"), "try 2"); eq(i.uses_left("lockpick"), 1, "one left")
	ok(i.use_charge("lockpick"), "try 3"); eq(i.count("lockpick"), 0, "pick spent"); ok(not i.use_charge("lockpick"), "none left")

func test_mags() -> void:
	print("[inventory_test] magazines")
	var i = inv()
	var akm: Dictionary = i.add_weapon(Inv.make_weapon("akm", { "loaded": false }))
	eq(int(i.equipment["primary"]), int(akm["uid"]), "rifle goes to primary")
	var rig: Dictionary = i.add_gear(Inv.make_gear("rig_6sh112")); ok(i.equip_gear(int(rig["uid"])), "equip the 4-pouch rig")
	eq(i.ready_slots(), 4, "four ready slots")
	var a: Dictionary = i.add_mag(Inv.make_mag("mag_ak762_30")); var b: Dictionary = i.add_mag(Inv.make_mag("mag_ak762_30")); var c: Dictionary = i.add_mag(Inv.make_mag("mag_ak762_30"))
	eq(i.mags_for_weapon(akm).size(), 3, "three AK mags fit"); eq(i.mags_for_weapon(i.weapons[0]).size(), 2, "two PM mags fit the PM")
	ok(i.is_ready(int(a["uid"])) and i.is_ready(int(b["uid"])), "first two new mags fill the pouches (2 PM mags already there)")
	ok(not i.is_ready(int(c["uid"])), "fifth magazine rides in the pack")
	i.add("762_fmj", 50); i.add("762_hp", 20)
	eq(i.load_mag(a, "762_fmj", 30), 30, "load a full mag"); eq(i.count("762_fmj"), 20, "rounds taken from the kit")
	eq(i.load_mag(a, "762_hp", 5), 0, "one ammunition type per magazine")
	eq(i.load_mag(b, "762_hp", 10), 10, "HP into an empty mag"); eq(str(b["ammo"]), "762_hp", "mag remembers its type")
	eq(i.load_mag(c, "545_fmj", 10), 0, "wrong calibre refused")
	eq(i.load_mag(c, "762_fmj", 999), 20, "load caps at carried rounds"); eq(i.count("762_fmj"), 0, "kit empty of fmj")
	# best_mag: ready beats rounds; c has 20 (not ready), b has 10 (ready)
	var best = i.best_mag(akm)
	eq(int(best["uid"]), int(a["uid"]), "fullest ready mag first")
	best = i.best_mag(akm, a); eq(int(best["uid"]), int(b["uid"]), "ready 10-round mag beats the 20-round one in the pack")
	i.set_ready(int(a["uid"]), false); i.set_ready(int(c["uid"]), true)
	best = i.best_mag(akm); eq(int(best["uid"]), int(c["uid"]), "moving c to the rig changes the pick")
	ok(not i.set_ready(int(a["uid"]), true), "pouches are full")
	eq(i.unload_mag(b), 10, "unload returns the rounds"); eq(i.count("762_hp"), 20, "rounds back in the kit (10 loose + 10 unloaded)"); ok(b["ammo"] == null, "empty mag has no type")
	# fill_mags with mixed ammo: a is full, c (fmj) tops up with the 4 loose fmj, empty b takes the preferred type (hp,
	# the first type carried), one type per magazine
	i.add("762_fmj", 4)
	var loaded: int = i.fill_mags(akm)
	eq(loaded, 4 + 20, "fill loads 4 fmj into c and 20 hp into b")
	eq(int(a["rounds"]), 30, "a still full"); eq(int(c["rounds"]), 24, "c topped with the 4 loose fmj"); eq(int(b["rounds"]), 20, "b took all the hp")
	eq(str(c["ammo"]), "762_fmj", "c kept its type"); eq(str(b["ammo"]), "762_hp", "b took the type that was loose")
	eq(i.count("762_hp"), 0, "all hp loaded"); eq(i.count("762_fmj"), 0, "all fmj loaded")
	# mags weigh their rounds
	near(Inv.mag_weight(a), 0.33 + 30 * 0.016, 0.001, "mag weight with rounds")
	# weapon_by_uid / remove
	ok(i.weapon_by_uid(int(akm["uid"])) != null, "lookup by uid")
	ok(i.equip_weapon(int(akm["uid"]), "secondary"), "move to secondary"); ok(i.equipment["primary"] == null, "primary cleared"); eq(int(i.equipment["secondary"]), int(akm["uid"]), "in secondary")
	ok(not i.equip_weapon(int(akm["uid"]), "vest"), "weapons do not go in the vest slot")
	ok(i.weapon_in_slot(1) != null and i.weapon_in_slot("secondary") != null, "weapon_in_slot by index and name")

func test_attachments() -> void:
	print("[inventory_test] attachments and rails")
	var i = inv()
	var akm: Dictionary = i.weapon_in_slot("secondary")
	ok(Inv.attach(akm, "opt_kobra"), "Kobra on the AK dovetail")
	ok(not Inv.attach(akm, "opt_pso1"), "top slot occupied")
	ok(not Inv.attach(akm, "grip_rk1"), "no picatinny under a bare AK handguard")
	ok(Inv.attach(akm, "rail_akhg"), "railed handguard installs"); ok(Inv.attach(akm, "grip_rk1"), "grip now fits")
	ok(not Inv.attach(akm, "light_klesch"), "under slot taken by the grip")
	ok(Inv.attach(akm, "laser_perst"), "side rail from the handguard takes the laser")
	ok(not Inv.attach(akm, "opt_t1"), "T-1 needs picatinny on top")
	ok(not Inv.attach(akm, "rail_akhg"), "same rail twice refused")
	ok(Inv.attach(akm, "muz_pbs1"), "PBS-1 on the m14 thread")
	var fx: Dictionary = Inv.weapon_effects(akm)
	near(float(fx["recoil"]), 0.88 * 0.92, 0.001, "grip and suppressor recoil multiply"); near(float(fx["noise"]), 0.35, 0.001, "suppressed"); ok(bool(fx["laser"]), "laser on")
	near(float(fx["moa"]), 0.9 * 0.95, 0.001, "optic and suppressor dispersion")
	akm["parts"]["barrel"] = 50.0; akm["dirt"] = 0.5
	near(float(Inv.weapon_effects(akm)["moa"]), 0.9 * 0.95 * (1.0 + 0.5 * 0.9 + 0.5 * 0.15), 0.001, "worn barrel and fouling widen dispersion")
	akm["parts"]["barrel"] = 100.0; akm["dirt"] = 0.0
	var r = Inv.detach(akm, "rail_akhg")
	ok(r is Dictionary and "grip_rk1" in r["dropped"] and "laser_perst" in r["dropped"], "removing the handguard drops the grip and the laser")
	ok(not akm["attachments"].has("under") and not akm["attachments"].has("side"), "slots cleared")
	ok(Inv.detach(akm, "opt_kobra") == true, "detach the optic"); ok(Inv.attach(akm, "rail_akcover"), "railed dust cover"); ok(Inv.attach(akm, "opt_t1"), "T-1 on the new picatinny top")
	ok(Inv.detach(akm, "opt_pu") == false, "detaching what is not mounted")
	near(Inv.weapon_weight(akm), 3.5 + 0.3 + 0.12 + 0.45, 0.001, "weight = rifle + cover + T-1 + PBS-1 (no mag inserted)")
	# effective mounts and fits on a picatinny gun
	var m4: Dictionary = Inv.make_weapon("m4")
	ok(Inv.attach(m4, "grip_afg") and Inv.attach(m4, "opt_eotech") and Inv.attach(m4, "muz_ar_sup") and Inv.attach(m4, "stock_ctr"), "M4 takes AR parts")
	ok(not Inv.attach(m4, "muz_pbs1"), "PBS-1 thread does not fit the AR")

func test_weight() -> void:
	print("[inventory_test] weight, capacity, overweight")
	var i = inv()
	var w0: float = i.weight()
	ok(w0 > 3.0 and w0 < 12.0, "starter plus AKM kit weighs %.2f kg" % w0)
	eq(i.capacity(), 22.0, "10 kg + Tortilla 12")
	eq(i.overweight(), 0.0, "not overweight"); near(i.load_factor(), 0.0, 0.001, "load factor 0"); ok(i.can_sprint(), "can sprint")
	i.add("tushonka", 40)   # 16 kg
	ok(i.overweight() > 0.0, "overweight by %.1f kg" % i.overweight()); ok(i.load_factor() > 0.0 and i.load_factor() < 1.0, "partial load factor")
	i.add("tushonka", 30)   # +12 kg -> well past 1.5x
	near(i.load_factor(), 1.0, 0.001, "load factor caps at 1"); ok(not i.can_sprint(), "cannot sprint at 1.5x capacity")
	i.remove("tushonka", 70)
	var pack: Dictionary = i.add_gear(Inv.make_gear("pack_attack2")); i.equip_gear(int(pack["uid"]))
	eq(i.capacity(), 40.0, "bigger pack raises capacity")
	ok(G.storage.capacity() == INF, "storage is unlimited")

func test_armor_and_hits() -> void:
	print("[inventory_test] armour pieces and hit resolution")
	var i = inv()
	var vest: Dictionary = i.add_gear(Inv.make_gear("vest_6b23_2")); var helm: Dictionary = i.add_gear(Inv.make_gear("helm_ssh68"))
	ok(i.equipped_def("vest").get("id") == "vest_6b23_2" and i.equipped_def("helmet").get("id") == "helm_ssh68", "first vest and helmet auto-equip")
	var pieces: Array = i.armor_pieces()
	eq(pieces.size(), 2, "two armour pieces (rig has no insert)")
	var tv: Dictionary = i.add_gear(Inv.make_gear("rig_tv110")); i.equip_gear(int(tv["uid"]))
	eq(i.armor_pieces().size(), 3, "TV-110 adds a soft torso insert")
	i.equip_gear(int(i.gear[0]["uid"]))  # back to the belt
	pieces = i.armor_pieces()
	var fmj: Dictionary = D.ammo["762_fmj"]   # pen 3.4
	# class deltas against the 6B23-2 (class 4 at full durability): under, equal, over
	var under := { "damage": 40, "pen": 3.0 }; var equal := { "damage": 40, "pen": 4.0 }; var over := { "damage": 40, "pen": 5.0 }
	var r_under: Dictionary = D.resolve_hit(under, "torso", pieces, 1.0, 0.01)
	ok(not r_under["penetrated"] and r_under["blunt"], "one class under: stopped even on a lucky roll"); ok(float(r_under["damage"]) < 40 * 0.25, "blunt trauma is a fraction")
	var r_eq_lo: Dictionary = D.resolve_hit(equal, "torso", pieces, 1.0, 0.45); var r_eq_hi: Dictionary = D.resolve_hit(equal, "torso", pieces, 1.0, 0.55)
	ok(r_eq_lo["penetrated"] and not r_eq_hi["penetrated"], "equal class: a coin flip around 0.5")
	near(float(r_eq_lo["damage"]), 40 * 0.85, 0.01, "penetrating hits do 85 %"); near(float(r_eq_lo["armor_damage"]), 10.0, 0.01, "and cost the plate 25 %")
	near(float(r_eq_hi["armor_damage"]), 28.0, 0.01, "stopped hits cost the plate 70 %")
	var r_over: Dictionary = D.resolve_hit(over, "torso", pieces, 1.0, 0.99)
	ok(r_over["penetrated"], "one class over: through on the worst roll")
	var r_head: Dictionary = D.resolve_hit(fmj, "head", pieces, 1.0, 0.5)
	ok(r_head["penetrated"] and r_head["armor_hit"]["def"]["id"] == "helm_ssh68", "7.62 through a steel helmet"); near(float(r_head["damage"]), 40 * 1.9 * 0.85, 0.01, "head multiplier")
	var r_leg: Dictionary = D.resolve_hit(fmj, "legs", pieces, 1.0, 0.5)
	ok(r_leg["penetrated"] and r_leg["armor_hit"].is_empty(), "legs uncovered"); near(float(r_leg["damage"]), 40 * 0.6, 0.01, "leg multiplier")
	# damaged armour drops its effective class
	vest["durability"] = 0.0
	var r_worn: Dictionary = D.resolve_hit(under, "torso", pieces, 1.0, 0.5)
	ok(r_worn["penetrated"], "a shot-out vest (class 4 x 0.55 = 2.2) no longer stops pen 3")
	vest["durability"] = 130.0
	var rubber: Dictionary = D.ammo["12_rubber"]
	var r_rub: Dictionary = D.resolve_hit(rubber, "torso", pieces, 1.0, 0.99)
	near(float(r_rub["damage"]), 4 * 0.35, 0.01, "rubber: 35 % blunt")
	eq(D.zone_from_hit(0.9, 0.0), "head", "zone head"); eq(D.zone_from_hit(0.7, 0.9), "arms", "zone arms"); eq(D.zone_from_hit(0.55, 0.1), "stomach", "zone stomach"); eq(D.zone_from_hit(0.2, 0.0), "legs", "zone legs")
	i.remove_gear(int(helm["uid"]))

func test_damage_and_kit() -> void:
	print("[inventory_test] damage node and kit")
	var i = inv(); var dmg: Node = G.damage; var kit: Node = G.kit
	ok(dmg != null and kit != null and dmg.get_parent() == G.player, "Damage and Kit nodes under the player")
	ok(G.player.dmg == dmg and G.player.kit == kit, "player.dmg / player.kit set")
	G.state["hp"] = 100.0; G.state["bleeding"] = false
	var vest: Dictionary = i.equipped("vest"); var d0 := float(vest["durability"])
	var r: Dictionary = dmg.bullet("762_fmj", 0.7, 0.1, { "source": "mimic" })
	eq(str(r["zone"]), "torso", "torso hit"); ok(float(vest["durability"]) < d0, "vest took durability")
	ok(float(G.state["hp"]) < 100.0, "hp lost: %.1f" % float(G.state["hp"]))
	if bool(r["penetrated"]): ok(bool(G.state["bleeding"]), "penetrating torso hit bleeds")
	else: ok(not bool(G.state["bleeding"]), "blunt trauma does not bleed")
	# bleeding rule and bandage use
	G.state["bleeding"] = true; G.state["hp"] = 50.0
	dmg._process(3.1); near(float(G.state["hp"]), 49.0, 0.01, "1 HP per 3 s while bleeding")
	ok(dmg.use("bandage", true), "bandage used"); eq(i.count("bandage"), 1, "one bandage consumed"); ok(not bool(G.state["bleeding"]), "bleeding stopped"); near(float(G.state["hp"]), 59.0, 0.01, "+10")
	ok(not dmg.use("probe"), "a probe is not a consumable")
	# heal over time and buffs
	i.add("medkit", 1); ok(dmg.use("medkit", true), "IFAK"); dmg._process(4.0); near(float(G.state["hp"]), 59.0 + 22.5, 0.1, "+45 over 8 s: half after 4 s")
	dmg._process(10.0); near(float(G.state["hp"]), 100.0, 0.1, "capped at 100 and finished")
	i.add("morphine", 1); dmg.use("morphine", true); ok(dmg.painkiller, "painkiller on"); near(dmg.other(20.0, { "kind": "fall" }), 18.0, 0.01, "painkiller -10 %")
	near(dmg.other(20.0, { "kind": "slash", "source": "slider" }), 20.0 * (1.0 - 0.24) * 0.9, 0.01, "vest softens a slash (class 4 x 6 %)")
	near(dmg.other(30.0, { "kind": "blast" }), 30.0 * 0.9, 0.01, "helmet? none worn -> painkiller only");
	i.add("cigarettes", 1); dmg.use("cigarettes", true); near(dmg.steady_mul, 0.6, 0.001, "steady hands")
	i.add("adrenaline", 1); dmg.use("adrenaline", true); near(dmg.speed_mul, 1.15, 0.001, "adrenaline speed"); dmg._process(31.0); near(dmg.speed_mul, 1.0, 0.001, "worn off")
	# kit: batteries shared across torch, headlamp, night vision
	G.state["flashlight"]["battery"] = 20.0
	eq(int(kit.battery_state()["cells"]), 1, "one cell carried")
	ok(kit.insert_battery("torch"), "cell into the torch"); near(float(G.state["flashlight"]["battery"]), 100.0, 0.01, "torch full"); eq(i.count("battery"), 0, "cell used")
	ok(not kit.insert_battery("torch"), "no cells left")
	var lamp: Dictionary = i.add_gear(Inv.make_gear("head_lamp")); eq(float(lamp["charge"]), 100.0, "headlamp charged")
	ok(kit.has_headlamp(), "headlamp worn"); ok(kit.toggle_headlamp(), "lamp on"); ok(kit.headlamp_on and kit.headlamp_energy() > 0.0, "lamp lit")
	kit._process(60.0); near(float(lamp["charge"]), 100.0 - 100.0 / 5.0, 0.5, "one in-game hour drains a fifth of the lamp cell")
	lamp["charge"] = 0.5; kit._process(2.0); ok(not kit.headlamp_on, "lamp dies with the cell")
	i.add("battery", 2); ok(kit.insert_battery("headlamp"), "fresh cell in the lamp"); near(float(lamp["charge"]), 100.0, 0.01, "lamp full")
	var nvg: Dictionary = i.add_gear(Inv.make_gear("head_pnv57")); ok(i.equip_gear(int(nvg["uid"])), "swap to the PNV-57")
	ok(not kit.has_headlamp() and kit.has_nvg(), "one headgear slot"); ok(kit.toggle_nvg(), "tubes on"); eq(kit.nvg_gen(), 1, "gen 1")
	kit._process(60.0); near(float(nvg["charge"]), 75.0, 0.5, "four in-game hours per cell")
	G.state["flashlight"]["on"] = true; kit._process(0.1); ok(kit.nvg_blind >= 0.6, "torch blooms the tubes"); G.state["flashlight"]["on"] = false
	E.weapon_fired.emit({}); near(kit.nvg_blind, 1.0, 0.001, "muzzle flash whites the tubes"); kit._process(2.0); ok(kit.nvg_blind < 0.1, "and it fades")
	kit.toggle_nvg(); ok(not kit.nvg_on, "tubes off")
	# masks and filters
	eq(kit.gas_protection(), 0.0, "no mask")
	var resp: Dictionary = i.add_gear(Inv.make_gear("mask_resp")); near(kit.gas_protection(), 0.5, 0.001, "respirator halves the burn")
	near(dmg.other(10.0, { "kind": "anomaly", "type": "gas" }), 10.0 * 0.5 * 0.9, 0.01, "gas burn halved (painkiller still on)")
	kit.gas_exposure(1.0, 60.0); near(float(resp["charge"]), 50.0, 0.5, "a minute of full gas eats half the filter")
	kit.gas_exposure(1.0, 70.0); eq(kit.gas_protection(), 0.0, "spent filter protects nothing")
	ok(not kit.replace_filter(), "no filters carried"); i.add("filter", 1); ok(kit.replace_filter(), "filter swapped"); near(float(resp["charge"]), 100.0, 0.01, "fresh filter")
	var gp7: Dictionary = i.add_gear(Inv.make_gear("mask_gp7")); i.equip_gear(int(gp7["uid"]))
	near(kit.gas_protection(), 1.0, 0.001, "GP-7 stops gas"); near(kit.mask_fov(), 0.92, 0.001, "mask narrows the view"); near(kit.audio_muffle(), 0.85, 0.001, "muffled")
	kit.gas_exposure(1.0, 60.0); near(float(gp7["charge"]), 100.0 - 50.0 / 1.6, 0.5, "the 160 filter lasts longer")
	# detectors: the best carried wins
	ok(kit.detector_def().is_empty(), "no detector"); ok(not kit.set_detector(true), "cannot raise what you do not have")
	i.add("detector", 1); eq(str(kit.detector_def()["id"]), "detector", "Veer"); i.add("detector2", 1); eq(str(kit.detector_def()["id"]), "detector2", "Bear outranks Veer")
	ok(kit.set_detector(true) and kit.detector_out, "detector raised")
	var art := Node3D.new(); art.add_to_group("artifacts"); art.set("name", "art_pearl"); root.add_child(art); art.global_position = G.player.global_position + Vector3(0, 0, -10)
	kit._process(0.5); ok(kit.det_strength > 0.5 and kit.det_interval < 1.0, "ticks fast near an artifact (%.2f s)" % kit.det_interval)
	art.global_position = G.player.global_position + Vector3(0, 0, -45); kit._process(0.5); ok(kit.det_strength < 0.3 and kit.det_interval > 1.0, "slow at 45 m")
	art.global_position = G.player.global_position + Vector3(-20, 0, -5); kit._process(0.5); ok(kit.det_dir < -0.3, "Bear's needle points left (%.2f)" % kit.det_dir)
	art.queue_free()
	# timed consumable use through the quick slot
	i.set_quick(2, "bandage"); G.state["hp"] = 40.0
	ok(kit.use_quick(2), "quick slot 8 starts a bandage"); eq(kit.using, "bandage", "using"); kit._process(1.0); near(kit.use_progress, 1.0 / 3.0, 0.01, "a third through")
	kit._process(2.1); eq(kit.using, "", "done"); near(float(G.state["hp"]), 50.0, 0.01, "+10 applied after 3 s"); eq(i.count("bandage"), 0, "bandage consumed")
	ok(not kit.use_quick(2), "empty slot clicks")
	ok(kit.speed_mul() < 1.0 and kit.speed_mul() > 0.85, "vest slows a little (%.2f)" % kit.speed_mul())
	var st: Dictionary = kit.state(); ok(st.has("battery") and st.has("quick") and st.has("det_strength"), "HUD state exposed")

func test_quick_and_transfer() -> void:
	print("[inventory_test] quick slots and the stash")
	var i = inv(); var s = G.storage
	i.set_quick(1, "probe"); eq(str(i.quick[1]), "probe", "probe on key 7"); i.set_quick(9, "x"); eq(i.quick.size(), 4, "out of range ignored")
	var entry := {}
	for e in i.list(): if e["kind"] == "weapon" and e["id"] == "akm": entry = e
	ok(not entry.is_empty(), "AKM listed"); ok(i.transfer(entry, s), "AKM to the stash")
	eq(s.weapons.size(), 1, "stash holds it"); ok(i.weapon_by_uid(int(entry["uid"])) == null, "gone from the kit"); ok(i.equipment["secondary"] == null, "slot cleared")
	ok(s.equipment["primary"] == null, "the stash does not equip")
	ok(i.transfer({ "kind": "item", "id": "probe", "count": 6 }, s, 4), "four probes to the stash"); eq(i.count("probe"), 2, "two left"); eq(s.count("probe"), 4, "four stashed")
	ok(s.transfer(s.list()[0], i), "and the AKM back"); eq(i.weapons.size(), 2, "two weapons carried"); ok(i.equipment["primary"] != null or i.equipment["secondary"] != null, "re-equipped")

func test_save_load() -> void:
	print("[inventory_test] save / load round trip")
	var i = inv()
	var akm: Dictionary = i.weapon_by_uid(int(i.equipment["primary"])) if i.equipment["primary"] != null else i.weapon_by_uid(int(i.equipment["secondary"]))
	var before := JSON.stringify(G.state["inventory"])
	var uid_before: int = Inv._uid
	var mags_before: int = i.mags.size(); var rounds_before := 0
	for m in i.mags: rounds_before += int(m["rounds"])
	G.state["money"] = 1234
	ok(G.save_game(), "saved")
	G.state = G.default_state(); G._setup_systems()
	eq(G.inventory.weapons.size(), 1, "fresh state has the starter kit again")
	ok(G.load_game(), "loaded")
	var j = G.inventory
	eq(int(G.state["money"]), 1234, "money back")
	eq(j.weapons.size(), 2, "both weapons back"); eq(j.mags.size(), mags_before, "magazines back")
	var rounds_after := 0
	for m in j.mags: rounds_after += int(m["rounds"])
	eq(rounds_after, rounds_before, "rounds intact")
	ok(j.weapon_by_uid(int(akm["uid"])) != null, "uids survive"); ok(typeof(j.weapons[0]["uid"]) == TYPE_INT, "uids are ints after JSON")
	ok(typeof(j.mags[0]["rounds"]) == TYPE_INT, "rounds are ints after JSON")
	ok(Inv._uid >= uid_before, "uid counter above every saved uid")
	var w2: Dictionary = j.weapon_by_uid(int(akm["uid"]))
	eq(w2["rails"].size(), akm["rails"].size(), "rails survive"); eq(w2["attachments"].size(), akm["attachments"].size(), "attachments survive")
	eq(JSON.stringify(G.state["inventory"]["equipment"]), JSON.stringify(JSON.parse_string(before)["equipment"]).replace(".0", ""), "equipment identical")
	ok(G.storage.count("probe") == 4, "stash survives the round trip")
	ok(G.damage != null and G.kit != null and G.damage.get_parent() == G.player, "player nodes intact after load")
	# a second load with the systems already alive re-syncs instead of duplicating nodes
	ok(G.load_game(), "loaded again"); eq(G.player.get_children().filter(func(c): return c.name == "Damage").size(), 1, "one Damage node")
