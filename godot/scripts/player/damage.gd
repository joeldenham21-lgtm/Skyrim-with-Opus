extends Node
## Player damage model (GEAR.md §3). Node "Damage" under the player (Game.player.dmg / Game.damage).
##   bullet(ammo_id_or_def, h01, lateral01, info)  resolves the hit zone and the armour piece over it with
##                                                 Data.resolve_hit, damages the armour, applies bleeding rules.
##   other(amount, info)                            melee / slash / blast / anomaly / fall: vests soften slashes, helmets
##                                                 soften blasts, masks cut gas (through the kit).
##   use(item_id, consume)                          consumable effects: stopBleed, heal, healOver, stamina, painkiller,
##                                                 steady, speedFor, staminaRegen, cure.
## Buffs are read by the player and the weapons: speed_mul, stamina_regen_mul, steady_mul (sway/spread), painkiller.
## Bleeding (DESIGN.md §4): a penetrating gunshot or a slash of 8+ damage starts it; 1 HP every 3 s until bandaged.
signal item_used(id: String)
signal armor_hit(info: Dictionary)

const BLEED_INTERVAL := 3.0
var painkiller_t := 0.0
var steady_t := 0.0
var speed_t := 0.0
var speed_m := 1.0
var regen_t := 0.0
var regen_m := 1.0
var heal_queue: Array = []
var bleed_t := 0.0
var last_hit := {}

var speed_mul: float:
	get: return speed_m if speed_t > 0.0 else 1.0
var stamina_regen_mul: float:
	get: return regen_m if regen_t > 0.0 else 1.0
var steady_mul: float:
	get: return 0.6 if steady_t > 0.0 else 1.0
var painkiller: bool:
	get: return painkiller_t > 0.0
var steady: bool:
	get: return steady_t > 0.0
var bleeding: bool:
	get: return bool(Game.state.get("bleeding", false))

func _ready() -> void:
	name = "Damage"
	if not Events.player_damaged.is_connected(_on_player_damaged): Events.player_damaged.connect(_on_player_damaged)
	if not Events.game_started.is_connected(_on_game_started): Events.game_started.connect(_on_game_started)

func _on_game_started(_new_game: bool) -> void:
	painkiller_t = 0.0; steady_t = 0.0; speed_t = 0.0; regen_t = 0.0; heal_queue.clear(); bleed_t = 0.0

func _player() -> Node:
	var p: Node = Game.player
	return p if p != null and is_instance_valid(p) else null

## A bullet hit. h01 = height fraction along the capsule (0 feet .. 1 crown), lateral01 = lateral offset (0 centre .. 1 edge).
## info: { source, what, mult }. Returns the resolve_hit result plus zone and the damage actually applied.
func bullet(ammo: Variant, h01: float = 0.6, lateral01: float = 0.3, info: Dictionary = {}) -> Dictionary:
	var a: Dictionary = ammo if ammo is Dictionary else Data.ammo.get(str(ammo), {})
	if a.is_empty(): return {}
	var zone := Data.zone_from_hit(h01, lateral01)
	var pieces: Array = Game.inventory.armor_pieces() if Game.inventory != null else []
	var r := Data.resolve_hit(a, zone, pieces, float(info.get("mult", 1.0)))
	var piece: Dictionary = r.get("armor_hit", {})
	var armor_id := ""
	if not piece.is_empty() and piece.get("inst") is Dictionary:
		var inst: Dictionary = piece["inst"]
		var maxd := float(piece["def"].get("durability", 1.0))
		inst["durability"] = maxf(0.0, float(inst.get("durability", maxd)) - float(r.get("armor_damage", 0.0)))
		armor_id = str(piece["def"].get("id", ""))
		Audio.play("armor_pen" if r["penetrated"] else ("helmet_ring" if zone == "head" else "armor_hit"), null, 0.8)
		armor_hit.emit({ "id": armor_id, "slot": piece.get("slot", ""), "penetrated": r["penetrated"], "durability": inst["durability"], "zone": zone })
		Events.inventory_changed.emit(armor_id, 0)
	var dmg := float(r["damage"]) * (0.9 if painkiller else 1.0)
	var pinfo := { "kind": "bullet", "source": info.get("source"), "what": info.get("what"), "zone": zone, "penetrated": r["penetrated"],
		"ammo_id": str(a.get("id", "")), "armor": armor_id, "blunt": r.get("blunt", false) }
	if not (bool(r["penetrated"]) and zone != "head"): pinfo["bleed"] = false
	var p := _player()
	if p != null and p.has_method("damage"): p.damage(dmg, pinfo)
	Events.player_hit.emit({ "zone": zone, "penetrated": r["penetrated"], "damage": dmg, "armor": armor_id, "blunt": r.get("blunt", false), "source": info.get("source") })
	r["zone"] = zone; r["applied"] = dmg
	last_hit = r
	return r

## Everything that is not a bullet. info.kind: melee | slash | blast | anomaly (info.type: gas|fire|arc|...) | fall | bleed.
func other(amount: float, info: Dictionary = {}) -> float:
	var dmg := amount
	var kind := str(info.get("kind", ""))
	if kind == "slash" or kind == "melee":
		var v: Dictionary = Game.inventory.equipped_def("vest") if Game.inventory != null else {}
		if not v.is_empty():
			dmg *= 1.0 - minf(0.35, float(v.get("cls", 0)) * 0.06)
			var g: Variant = Game.inventory.equipped("vest")
			if g is Dictionary: g["durability"] = maxf(0.0, float(g.get("durability", v.get("durability", 40))) - amount * 0.2)
	elif kind == "blast":
		if Game.inventory != null and not Game.inventory.equipped_def("helmet").is_empty(): dmg *= 0.9
	elif kind == "anomaly" and str(info.get("type", "")) == "gas":
		var k: Node = Game.kit
		if k != null and k.has_method("gas_protection"): dmg *= 1.0 - float(k.gas_protection())
	if kind != "bleed": dmg *= 0.9 if painkiller else 1.0
	var p := _player()
	if dmg > 0.0 and p != null and p.has_method("damage"): p.damage(dmg, info)
	return dmg

## Apply a consumable's effect. consume=true also takes one from the kit first (false when nothing is carried).
func use(item_id: String, consume: bool = false) -> bool:
	var d := Data.def(item_id)
	if d.is_empty() or not (d.get("effect") is Dictionary): return false
	if consume:
		if Game.inventory == null or not Game.inventory.remove(item_id, 1): return false
	var e: Dictionary = d["effect"]
	var p := _player()
	if p == null: return false
	if e.get("stopBleed", false) or e.get("cure", false): p.stop_bleeding()
	if float(e.get("heal", 0)) > 0.0: p.heal(float(e["heal"]))
	if e.get("healOver") is Array and e["healOver"].size() >= 2:
		heal_queue.append({ "total": float(e["healOver"][0]), "left": float(e["healOver"][0]), "dur": maxf(0.1, float(e["healOver"][1])) })
	if float(e.get("stamina", 0)) > 0.0: p.add_stamina(float(e["stamina"]))
	if e.has("painkiller"): painkiller_t = maxf(painkiller_t, float(e["painkiller"]))
	if e.has("steady"): steady_t = maxf(steady_t, float(e["steady"]))
	if e.get("speedFor") is Array and e["speedFor"].size() >= 2: speed_t = float(e["speedFor"][0]); speed_m = float(e["speedFor"][1])
	if e.get("staminaRegen") is Array and e["staminaRegen"].size() >= 2: regen_t = float(e["staminaRegen"][0]); regen_m = float(e["staminaRegen"][1])
	item_used.emit(item_id)
	return true

func healing_left() -> float:
	var s := 0.0
	for h in heal_queue: s += float(h["left"])
	return s

## HUD state.
func state() -> Dictionary:
	return { "painkiller": painkiller_t, "steady": steady_t, "speed": speed_t, "speed_mul": speed_mul, "regen": regen_t, "regen_mul": stamina_regen_mul,
		"healing": healing_left(), "bleeding": bleeding, "last_hit": last_hit }

## Bleeding starts on a gunshot or slash of 8+ unless the hit said otherwise (blunt trauma, head shots, falls).
func _on_player_damaged(amount: float, info: Dictionary) -> void:
	if info.get("bleed", true) == false: return
	if amount >= 8.0 and str(info.get("kind", "")) in ["bullet", "slash"]: Game.state["bleeding"] = true

func _process(dt: float) -> void:
	if Game.mode != "playing": return
	var p := _player()
	if p == null or not bool(p.get("alive")): return
	painkiller_t = maxf(0.0, painkiller_t - dt); steady_t = maxf(0.0, steady_t - dt)
	speed_t = maxf(0.0, speed_t - dt); regen_t = maxf(0.0, regen_t - dt)
	for i in range(heal_queue.size() - 1, -1, -1):
		var h: Dictionary = heal_queue[i]
		var step := minf(float(h["left"]), float(h["total"]) / float(h["dur"]) * dt)
		if step > 0.0: p.heal(step)
		h["left"] = float(h["left"]) - step
		if float(h["left"]) <= 0.001: heal_queue.remove_at(i)
	if bleeding:
		bleed_t += dt
		if bleed_t >= BLEED_INTERVAL:
			bleed_t = 0.0
			var hp := float(Game.state.get("hp", 100.0))
			if hp > 1.0: Game.state["hp"] = maxf(1.0, hp - 1.0)
			elif not bool(p.get("in_base")): other(1.0, { "kind": "bleed", "bleed": false })
	else: bleed_t = 0.0
