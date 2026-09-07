extends "res://tools/scenarios/_driver.gd"
## Every full-screen form, with a realistic Explorer's kit on the desk. Shots land in .shots/panels/.
##   tools/shot.sh tools/scenarios/panels.gd 1920x1080

var host: Node = null

func run() -> void:
	await start(true)
	Game.set_mode("paused")
	_test_kit()
	host = load("res://scripts/ui/panel_host.gd").ensure(get_tree())
	await frames(2)

	await _shot_panel("inventory", "inventory")
	await _shot_panel("workbench", "workbench")
	await _shot_panel("workbench", "workbench-maintenance", { "tab": "maintenance" })
	await _shot_panel("workbench", "workbench-magazines", { "tab": "magazines" })
	await _shot_panel("loot", "loot", _loot_data())
	await _shot_panel("supply", "supply")
	await _shot_panel("supply", "supply-return", { "tab": "sell" })
	await _shot_panel("terminal", "terminal")
	await _shot_panel("terminal", "terminal-status", { "tab": "status" })
	await _shot_panel("storage", "storage")
	await _shot_panel("map", "map")
	await _shot_panel("bed", "bed")
	await _shot_panel("death", "death", { "kind": "bullet", "ammo": "762_fmj", "zone": "torso", "penetrated": true, "source": "mimic" })
	print("[panels] done")

func _shot_panel(name: String, shot_name: String, d: Dictionary = {}) -> void:
	if host != null and host.is_open: host.close()
	await frames(2)
	if host == null or not host.open(name, d):
		print("[panels] skip %s (no form)" % name); return
	await frames(8)
	await shot(shot_name)

# ------------------------------------------------------------------------------------------------------------------
## A kit that exercises every section of the manifest: a worn AKM with fouling and a worn bolt, a Mosin, five
## magazines of three kinds, three calibres of loose rounds, meds, tools, armour, attachments, parts and artifacts.
func _test_kit() -> void:
	var inv: Inventory = Game.inventory
	if inv == null: return
	var akm := Inventory.make_weapon("akm", { "ammo": "762_fmj", "condition": 72 })
	akm["parts"]["bolt"] = 46.0
	akm["dirt"] = 0.38
	if akm.get("mag") is Dictionary: akm["mag"]["rounds"] = 17
	Inventory.attach(akm, "rail_akcover")
	Inventory.attach(akm, "opt_kobra")
	inv.add_weapon(akm)
	var mosin := Inventory.make_weapon("mosin", { "ammo": "754_fmj" })
	mosin["parts"]["barrel"] = 55.0
	inv.add_weapon(mosin)
	for m in [["mag_ak762_30", "762_fmj", 30], ["mag_ak762_30", "762_ap", 12], ["mag_ak762_30", "", 0],
			["mag_ak762_40", "762_fmj", 40], ["mag_mosin5", "754_fmj", 5]]:
		inv.add_mag(Inventory.make_mag(str(m[0]), null if str(m[1]) == "" else str(m[1]), int(m[2])))
	var rig := inv.add_gear(Inventory.make_gear("rig_6sh112"))
	var pack := inv.add_gear(Inventory.make_gear("pack_pilgrim"))
	inv.add_gear(Inventory.make_gear("vest_6b2", { "durability": 48.0 }))
	inv.add_gear(Inventory.make_gear("helm_ssh68", { "durability": 30.0 }))
	inv.add_gear(Inventory.make_gear("vest_kirasa", { "durability": 70.0 }))
	inv.add_gear(Inventory.make_gear("head_lamp", { "charge": 64.0 }))
	inv.add_gear(Inventory.make_gear("mask_resp", { "charge": 80.0 }))
	inv.equip_gear(int(rig["uid"]), "rig")
	inv.equip_gear(int(pack["uid"]), "backpack")
	var items := { "762_fmj": 60, "762_ap": 30, "762_hp": 10, "754_fmj": 15, "9x18_ap": 8, "bandage": 3, "medkit": 1,
		"morphine": 1, "water": 1, "tushonka": 1, "cigarettes": 2, "probe": 6, "battery": 3, "filter": 2, "cleankit": 1,
		"repairkit": 1, "armorkit": 1, "part_bolt": 1, "part_barrel": 1, "gr_rgd5": 2, "gr_smoke": 1, "art_pearl": 2,
		"art_tear": 1, "recorder": 1, "rail_akhg": 1, "opt_eotech": 1, "muz_pbs1": 1, "grip_rk1": 1, "light_klesch": 1,
		"lockpick": 1, "binoculars": 1 }
	for id in items: inv.add(str(id), int(items[id]))
	for m in inv.mags:
		if inv.ready_mags.size() < inv.ready_slots(): inv.set_ready(int(m["uid"]), true)
	Game.state["money"] = 4120
	Game.state["earned"] = 6800
	Game.state["hp"] = 71.0
	Game.state["stats"] = { "kills": 23, "shots": 412, "artifacts": 7, "deaths": 1, "tides": 2, "distance": 18420.0 }
	# something in the locker so the stash has two sides
	var st: Inventory = Game.storage
	if st != null:
		st.add_weapon(Inventory.make_weapon("pm", { "ammo": "9x18_fmj" }))
		st.add("9x18_fmj", 48)
		st.add("bandage", 4)
		st.add_gear(Inventory.make_gear("vest_paca"))

func _loot_data() -> Dictionary:
	var items: Array = []
	var w := Inventory.make_weapon("aks74u", { "ammo": "545_fmj", "condition": 44 })
	if not w.is_empty():
		if w.get("mag") is Dictionary: w["mag"]["rounds"] = 9
		w["dirt"] = 0.6
		items.append({ "kind": "weapon", "id": "aks74u", "count": 1, "inst": w })
	var m := Inventory.make_mag("mag_ak545_30", "545_fmj", 22)
	if not m.is_empty(): items.append({ "kind": "mag", "id": "mag_ak545_30", "count": 1, "inst": m })
	var g := Inventory.make_gear("vest_6b23_1", { "durability": 22.0 })
	if not g.is_empty(): items.append({ "kind": "gear", "id": "vest_6b23_1", "count": 1, "inst": g })
	for pair in [["545_fmj", 44], ["bandage", 2], ["battery", 1], ["dogtag", 1], ["art_ember", 1]]:
		if not Data.def(str(pair[0])).is_empty(): items.append({ "kind": "item", "id": str(pair[0]), "count": int(pair[1]) })
	return { "source": null, "kind": "corpse", "name": "EXPLORER 44", "title": "EXPLORER 44 · RAIL CUTTING",
		"code": "UNPSC · RECOVERY", "items": items, "locked": false, "table": "explorer_pack" }
