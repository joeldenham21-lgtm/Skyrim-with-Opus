extends "res://tools/scenarios/_driver.gd"
## Renders the loot piles: a mimic's ash and rifle, an explorer under a tarp with a pack, and dropped kit, at noon
## outside the gate. tools/shot.sh tools/tests/loot_shot.gd
func run() -> void:
	await start(true)
	var L: Node = Game.loot
	var ML: GDScript = load("res://scripts/loot/loadout.gd")
	var rng := RandomNumberGenerator.new(); rng.seed = 11
	var base := Vector3(0.0, 0.0, 270.0)
	var lo: Dictionary = ML.roll("veteran", 2, rng)
	var y := float(Game.world.get_height(base.x, base.z))
	L.spawn_mimic_pile(Vector3(base.x - 1.4, y, base.z - 1.0), lo)
	L.spawn_pile(Vector3(base.x + 2.2, float(Game.world.get_height(base.x + 2.2, base.z - 1.6)), base.z - 1.6), [{ "kind": "item", "id": "dogtag", "count": 1 }, { "kind": "weapon", "id": "sks", "count": 1, "inst": load("res://scripts/inventory/inventory.gd").make_weapon("sks", { "condition": 40 }) }], "explorer")
	L.spawn_pile(Vector3(base.x + 0.4, float(Game.world.get_height(base.x + 0.4, base.z + 1.2)), base.z + 1.2), [{ "kind": "item", "id": "probe", "count": 3 }], "pile")
	set_hour(12.0); torch(false)
	teleport(base.x, base.z + 3.6); look(0.0, -0.42)
	await frames(8)
	await shot("piles-noon")
	teleport(base.x - 1.4, base.z + 1.4); look(0.0, -0.75)
	await frames(4)
	await shot("mimic-pile-close")
	teleport(base.x + 2.2, base.z + 1.4); look(0.0, -0.62)
	await frames(4)
	await shot("explorer-close")
	set_hour(21.5); torch(true)
	teleport(base.x, base.z + 3.2); look(0.0, -0.4)
	await frames(6)
	await shot("piles-night-torch")
	print("[stats] ", JSON.stringify(stats()))
