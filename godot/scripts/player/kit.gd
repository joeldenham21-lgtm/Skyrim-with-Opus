extends Node
## Player kit (GEAR.md §5). Node "Kit" under the player (Game.player.kit / Game.kit). Logic and state only; the HUD,
## the lights and the post effects read state() and the properties here.
##   Batteries: one kind of cell feeds the torch (Game.state.flashlight, drained by the player), the headlamp and the
##   night vision (gear instance `charge`). insert_battery(target) swaps a cell in.
##   Headgear: toggle_headlamp(), toggle_nvg(); nvg_gen(), nvg_blind (tubes bloomed by the torch or a muzzle flash).
##   Masks: gas_protection() 0..1 (respirator 0.5, GP-5/GP-7 1.0, nothing when the filter is spent); gas_exposure(i, dt)
##   drains the filter; replace_filter(); mask_fov(), audio_muffle().
##   Detectors: the best carried detector (Veer 30 m, Bear 50 m + needle, Svarog 70 m + type); set_detector(on);
##   det_interval/det_strength/det_dir (-1 left .. 1 right)/det_name; signal detector_tick.
##   Quick slots 6-9: use_quick(i) throws grenades through the weapons node or starts a timed consumable use
##   (item `use` seconds) that ends in Damage.use(); using/use_progress for the HUD.
##   Load: speed_mul(), stamina_drain_mul(), stamina_regen_mul(), can_sprint() fold gear speed/stamina multipliers,
##   overweight and buffs together for the player controller.
signal detector_tick(strength: float)
signal quick_used(id: String)
signal use_started(id: String, seconds: float)
signal use_finished(id: String)
signal device_changed(device: String, on: bool)

const TORCH_HOURS := 7.0      # in-game hours per cell (matches the player's drain)
const LAMP_HOURS := 5.0
const NVG_HOURS := 4.0
const FILTER_SECONDS := 120.0 # real seconds of full gas a 100-unit filter lasts (two in-game hours)
const IN_GAME_HOUR := 60.0    # real seconds

var headlamp_on := false
var nvg_on := false
var binoculars := false
var detector_out := false
var using := ""
var use_t := 0.0
var use_need := 0.0
var nvg_blind := 0.0
var gas_level := 0.0
var det_interval := 2.0
var det_t := 0.0
var det_dist := INF
var det_dir := 0.0
var det_bearing := 0.0
var det_name := ""
var det_strength := 0.0
var det_target: Variant = null

var torch_on: bool:
	get: return bool(Game.state.get("flashlight", {}).get("on", false))
var use_progress: float:
	get: return clampf(use_t / use_need, 0.0, 1.0) if use_need > 0.0 else 0.0

func _ready() -> void:
	name = "Kit"
	if not Events.weapon_fired.is_connected(_on_weapon_fired): Events.weapon_fired.connect(_on_weapon_fired)
	if not Events.game_started.is_connected(_on_game_started): Events.game_started.connect(_on_game_started)
	if not Events.inventory_changed.is_connected(_on_inventory_changed): Events.inventory_changed.connect(_on_inventory_changed)

func _on_game_started(_new_game: bool) -> void:
	headlamp_on = false; nvg_on = false; binoculars = false; detector_out = false; using = ""; use_t = 0.0; use_need = 0.0; nvg_blind = 0.0; gas_level = 0.0

func _on_weapon_fired(_w: Dictionary) -> void:
	if nvg_on: nvg_blind = 1.0

func _on_inventory_changed(id: String, _delta: int) -> void:
	if id == "equip" or id == "*":
		# the headgear or mask changed under a running device
		if headlamp_on and headgear_def().get("light") == null: headlamp_on = false; device_changed.emit("headlamp", false)
		if nvg_on and headgear_def().get("nvg") == null: nvg_on = false; device_changed.emit("nvg", false)
		if detector_out and detector_def().is_empty(): detector_out = false; device_changed.emit("detector", false)

func _inv() -> Inventory:
	return Game.inventory

func _player() -> Node:
	var p: Node = Game.player
	return p if p != null and is_instance_valid(p) else null

# ------------------------------------------------------------------------------------------------------------------
# batteries and headgear
# ------------------------------------------------------------------------------------------------------------------
func headgear() -> Variant:
	return _inv().equipped("headgear") if _inv() != null else null
func headgear_def() -> Dictionary:
	return _inv().equipped_def("headgear") if _inv() != null else {}
func has_headlamp() -> bool: return headgear_def().get("light") != null
func has_nvg() -> bool: return headgear_def().get("nvg") != null
func headgear_charge() -> float:
	var g: Variant = headgear()
	return float(g.get("charge", 0.0)) if g is Dictionary else 0.0
func nvg_gen() -> int:
	return int(headgear_def().get("nvg", 0)) if nvg_on else 0
func headlamp_energy() -> float:
	if not headlamp_on: return 0.0
	var c := headgear_charge() / 100.0
	return float(headgear_def().get("light", 18)) * (0.55 + 0.45 * clampf(c * 3.0, 0.0, 1.0))

func toggle_headlamp() -> bool:
	if headlamp_on:
		headlamp_on = false; Audio.play("headlamp", null, 0.5); device_changed.emit("headlamp", false); return true
	if not has_headlamp() or headgear_charge() <= 0.0:
		Audio.play("click", null, 0.5); return false
	headlamp_on = true; nvg_on = false; Audio.play("headlamp", null, 0.5); device_changed.emit("headlamp", true)
	return true

func toggle_nvg() -> bool:
	if nvg_on:
		nvg_on = false; Audio.play("nvg_off", null, 0.6); device_changed.emit("nvg", false); return true
	if not has_nvg() or headgear_charge() <= 0.0:
		Audio.play("click", null, 0.5); return false
	nvg_on = true; headlamp_on = false; nvg_blind = 0.4; Audio.play("nvg_on", null, 0.6); device_changed.emit("nvg", true)
	return true

## Charge of each device (0..100, -1 when the device is not carried) and the loose cells.
func battery_state() -> Dictionary:
	var hg := headgear_def()
	return { "torch": float(Game.state.get("flashlight", {}).get("battery", 0.0)), "headlamp": headgear_charge() if hg.get("light") != null else -1.0,
		"nvg": headgear_charge() if hg.get("nvg") != null else -1.0, "cells": _inv().count("battery") if _inv() != null else 0 }

## Swap a cell into the torch, the headlamp or the night vision. Returns false without a cell or a device.
func insert_battery(target: String = "") -> bool:
	if _inv() == null or _inv().count("battery") <= 0: Audio.play("click", null, 0.4); return false
	if target == "": target = _lowest_device()
	match target:
		"torch":
			var f: Dictionary = Game.state["flashlight"]
			if float(f.get("battery", 0.0)) >= 99.0: return false
			_inv().remove("battery", 1); f["battery"] = 100.0
		"headlamp", "nvg":
			var g: Variant = headgear()
			if not (g is Dictionary) or not g.has("charge") or float(g["charge"]) >= 99.0: return false
			if (target == "headlamp" and not has_headlamp()) or (target == "nvg" and not has_nvg()): return false
			_inv().remove("battery", 1); g["charge"] = 100.0
		_: return false
	Audio.play("battery_swap", null, 0.6)
	Events.notice.emit("Cell replaced: %s." % target.to_upper(), "kit")
	return true

func _lowest_device() -> String:
	var b := battery_state(); var best := "torch"; var low := float(b["torch"])
	for k in ["headlamp", "nvg"]:
		if float(b[k]) >= 0.0 and float(b[k]) < low: low = float(b[k]); best = k
	return best

## How much light the player emits (0..1) for entity perception.
func emitted_light() -> float:
	var l := 0.0
	if torch_on: l = maxf(l, 0.9)
	if headlamp_on: l = maxf(l, 0.7)
	return l

# ------------------------------------------------------------------------------------------------------------------
# masks and gas
# ------------------------------------------------------------------------------------------------------------------
func mask() -> Variant:
	return _inv().equipped("mask") if _inv() != null else null
func mask_def() -> Dictionary:
	return _inv().equipped_def("mask") if _inv() != null else {}
func filter_charge() -> float:
	var m: Variant = mask()
	return float(m.get("charge", 0.0)) if m is Dictionary else 0.0
func gas_protection() -> float:
	var d := mask_def()
	if d.is_empty() or filter_charge() <= 0.0: return 0.0
	return clampf(float(d.get("gas", 0.0)), 0.0, 1.0)
## Anomalies report exposure each frame (intensity 0..1): the filter drains, the burn is scaled by gas_protection().
func gas_exposure(intensity: float, dt: float) -> void:
	gas_level = maxf(gas_level, clampf(intensity, 0.0, 1.0))
	var m: Variant = mask()
	if m is Dictionary and m.has("charge"):
		var cap := float(mask_def().get("filter", 100)) / 100.0
		m["charge"] = maxf(0.0, float(m["charge"]) - intensity * dt * 100.0 / (FILTER_SECONDS * cap))
func replace_filter() -> bool:
	var m: Variant = mask()
	if _inv() == null or not (m is Dictionary) or _inv().count("filter") <= 0: Audio.play("click", null, 0.4); return false
	if float(m.get("charge", 0.0)) >= 99.0: return false
	_inv().remove("filter", 1); m["charge"] = 100.0
	Audio.play("filter_swap", null, 0.6)
	Events.notice.emit("Filter replaced.", "kit")
	return true
func mask_fov() -> float: return float(mask_def().get("fov", 1.0))
func audio_muffle() -> float: return 0.85 if not mask_def().is_empty() else 1.0

# ------------------------------------------------------------------------------------------------------------------
# binoculars and detectors
# ------------------------------------------------------------------------------------------------------------------
func has_binoculars() -> bool: return _inv() != null and _inv().count("binoculars") > 0
func set_binoculars(on: bool) -> void:
	binoculars = on and has_binoculars()
func zoom() -> float: return float(Data.items.get("binoculars", {}).get("zoom", 8)) if binoculars else 1.0

## The best detector carried (longest range).
func detector_def() -> Dictionary:
	if _inv() == null: return {}
	var best := {}
	for id in _inv().items.keys():
		var d: Dictionary = Data.items.get(id, {})
		if d.get("detect") is Dictionary and int(_inv().items[id]) > 0:
			if best.is_empty() or float(d["detect"].get("range", 0)) > float(best["detect"].get("range", 0)): best = d
	return best
func set_detector(on: bool) -> bool:
	if on and detector_def().is_empty(): Audio.play("click", null, 0.4); return false
	if on == detector_out: return true
	detector_out = on; det_t = 0.4; det_strength = 0.0; det_dist = INF; det_name = ""; det_target = null
	Audio.play("weapon_draw", null, 0.5, 1.15)
	device_changed.emit("detector", on)
	return true

## Artifacts in range as [{ pos, id, node? }]. Uses the anomalies field API when it exists, else the "artifacts" group.
func _artifacts(pos: Vector3, range_m: float) -> Array:
	var out := []
	var an: Node = Game.world.get_node_or_null("Anomalies") if Game.world != null else null

	if an != null and an.has_method("detector_query"):
		for a in an.detector_query(pos, range_m):
			if a is Node3D: out.append({ "pos": a.global_position, "id": str(a.get("id")) if "id" in a else str(a.get("kind")), "node": a })
			elif a is Dictionary:
				var p: Variant = a.get("pos", a.get("position", a.get("center")))
				if p is Vector3: out.append({ "pos": p, "id": str(a.get("id", a.get("kind", ""))), "node": a.get("node") })
		return out
	for n in get_tree().get_nodes_in_group("artifacts"):
		if n is Node3D and n.global_position.distance_to(pos) <= range_m: out.append({ "pos": n.global_position, "id": str(n.get("id")) if "id" in n else n.name, "node": n })
	return out

func _detector_update(dt: float) -> void:
	var d := detector_def()
	var p := _player()
	if d.is_empty() or p == null: return
	var det: Dictionary = d["detect"]
	var range_m := float(det.get("range", 30))
	var pos: Vector3 = p.global_position
	det_dist = INF; det_target = null
	for a in _artifacts(pos, range_m):
		var dist: float = (a["pos"] as Vector3).distance_to(pos)
		if dist < det_dist: det_dist = dist; det_target = a
	if det_target == null:
		det_strength = 0.0; det_dir = 0.0; det_name = ""; det_interval = 2.6
	else:
		var k := clampf((det_dist - 2.0) / maxf(1.0, range_m - 2.0), 0.0, 1.0)
		det_strength = 1.0 - k
		det_interval = lerpf(0.08, 2.0, k * k)
		if bool(det.get("dir", false)):
			var to: Vector3 = (det_target["pos"] as Vector3) - pos; to.y = 0.0
			var fwd: Vector3 = p.look_dir() if p.has_method("look_dir") else Vector3.FORWARD; fwd.y = 0.0
			if to.length() > 0.01 and fwd.length() > 0.01:
				# positive = right of the look direction (Godot's +Y cross gives left), so the needle reads like a compass
				det_bearing = -atan2(fwd.cross(to.normalized()).y, fwd.normalized().dot(to.normalized()))
				det_dir = clampf(sin(det_bearing) * 1.4, -1.0, 1.0)
		else: det_dir = 0.0; det_bearing = 0.0
		det_name = Data.name_of(str(det_target.get("id", ""))) if bool(det.get("type", false)) else ""
	det_t -= dt
	if det_t <= 0.0:
		det_t = det_interval
		Audio.play("detector_tick", null, 0.35 + 0.45 * det_strength, 1.0 + det_strength * 0.25)
		detector_tick.emit(det_strength)

# ------------------------------------------------------------------------------------------------------------------
# quick slots and consumables
# ------------------------------------------------------------------------------------------------------------------
func quick_id(i: int) -> String:
	if _inv() == null or i < 0 or i > 3: return ""
	var q: Variant = _inv().quick[i]
	return str(q) if q != null else ""
func use_quick(i: int) -> bool:
	var id := quick_id(i)
	if id == "" or _inv().count(id) <= 0: Audio.play("click", null, 0.4); return false
	var d := Data.def(id)
	if str(d.get("kind", "")) == "grenade":
		var w: Node = _player().get("weapons") if _player() != null else null
		if w != null and w.has_method("throw_grenade"):
			w.throw_grenade(id); quick_used.emit(id); return true
		return false
	return use_item(id)
## Start using a consumable from the kit (bandage 3 s, IFAK 5 s ...). Batteries and filters swap at once.
func use_item(id: String) -> bool:
	if using != "" or _inv() == null or _inv().count(id) <= 0: return false
	var d := Data.def(id)
	match str(d.get("kind", "")):
		"battery": return insert_battery("")
		"filter": return replace_filter()
	if not (d.get("effect") is Dictionary): return false
	using = id; use_need = maxf(0.2, float(d.get("use", 1.0))); use_t = 0.0
	Audio.play("use_" + str(d.get("kind", "med")), null, 0.6)
	use_started.emit(id, use_need)
	return true
func cancel_use() -> void:
	using = ""; use_t = 0.0; use_need = 0.0
func _use_update(dt: float) -> void:
	if using == "": return
	use_t += dt
	if use_t < use_need: return
	var id := using
	using = ""; use_t = 0.0; use_need = 0.0
	var dmg: Node = Game.damage
	if dmg != null and dmg.has_method("use") and dmg.use(id, true):
		quick_used.emit(id); use_finished.emit(id)
		Events.notice.emit("%s used." % Data.name_of(id), "kit")

# ------------------------------------------------------------------------------------------------------------------
# load and movement multipliers for the player controller
# ------------------------------------------------------------------------------------------------------------------
func _gear_mul(field: String) -> float:
	if _inv() == null: return 1.0
	var m := 1.0
	for s in ["vest", "helmet", "backpack", "rig"]: m *= float(_inv().equipped_def(s).get(field, 1.0))
	return m
func load_factor() -> float: return _inv().load_factor() if _inv() != null else 0.0
func speed_mul() -> float:
	var buff := float(Game.damage.speed_mul) if Game.damage != null else 1.0
	return _gear_mul("speed") * lerpf(1.0, 0.6, load_factor()) * buff
func stamina_drain_mul() -> float: return _gear_mul("stamina") * (1.0 + load_factor())
func stamina_regen_mul() -> float:
	var buff := float(Game.damage.stamina_regen_mul) if Game.damage != null else 1.0
	return buff / sqrt(1.0 + load_factor())
func can_sprint() -> bool: return load_factor() < 1.0

## Everything the HUD shows.
func state() -> Dictionary:
	var det := detector_def()
	return { "torch": torch_on, "headlamp": headlamp_on, "nvg": nvg_on, "nvg_gen": nvg_gen(), "nvg_blind": nvg_blind, "battery": battery_state(),
		"mask": str(mask_def().get("name", "")), "filter": filter_charge(), "gas": gas_level, "gas_protection": gas_protection(),
		"binoculars": binoculars, "detector": str(det.get("name", "")), "detector_out": detector_out, "det_strength": det_strength, "det_dir": det_dir, "det_name": det_name, "det_dist": det_dist,
		"quick": [quick_id(0), quick_id(1), quick_id(2), quick_id(3)], "using": using, "use_progress": use_progress,
		"weight": _inv().weight() if _inv() != null else 0.0, "capacity": _inv().capacity() if _inv() != null else 0.0, "load": load_factor() }

func _process(dt: float) -> void:
	if Game.mode != "playing": return
	var p := _player()
	if p == null or not bool(p.get("alive")): return
	var g: Variant = headgear()
	if g is Dictionary and g.has("charge"):
		if headlamp_on:
			g["charge"] = maxf(0.0, float(g["charge"]) - dt * 100.0 / (LAMP_HOURS * IN_GAME_HOUR))
			if float(g["charge"]) <= 0.0: headlamp_on = false; Audio.play("click", null, 0.5); device_changed.emit("headlamp", false)
		if nvg_on:
			g["charge"] = maxf(0.0, float(g["charge"]) - dt * 100.0 / (NVG_HOURS * IN_GAME_HOUR))
			if float(g["charge"]) <= 0.0: nvg_on = false; Audio.play("nvg_off", null, 0.5); device_changed.emit("nvg", false)
	if nvg_on and torch_on: nvg_blind = maxf(nvg_blind, 0.6)
	nvg_blind = maxf(0.0, nvg_blind - dt * (0.9 if not torch_on else 0.0))
	gas_level = maxf(0.0, gas_level - dt * 0.8)
	if detector_out: _detector_update(dt)
	_use_update(dt)
