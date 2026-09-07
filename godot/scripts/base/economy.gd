extends Node
## Progression and the supply economy (GEAR.md §7). Node "Economy" under Game (Game.economy).
##   Clearance ranks 1-5 from data/ranks.json (money earned + contracts completed) gate the supply crate
##   (shop_items) and the terminal's contract tiers; rank-ups are announced as Committee notices.
##   Supply: buy(id, qty) issues instances (weapons loaded, magazines empty, gear at full durability) or stacks
##   (ammunition by lots of 10); sell(entry) buys back at 40 % of list, condition-weighted for weapons and armour,
##   loaded rounds returned to the kit first. Artifacts are submitted at the terminal at full price (sell_artifact).
signal rank_changed(rank: int, title: String)
const BUYBACK := 0.4
const AMMO_LOT := 10
const CATEGORY_LABEL := { "weapon": "Weapons", "ammo": "Ammunition", "mag": "Magazines", "attachment": "Attachments", "armor": "Body armour", "helmet": "Helmets",
	"pack": "Backpacks", "rig": "Rigs", "headgear": "Headgear", "mask": "Masks", "med": "Medical", "food": "Provisions", "tool": "Tools", "battery": "Power",
	"filter": "Filters", "grenade": "Grenades", "part": "Weapon parts", "melee": "Blades" }

func _ready() -> void:
	name = "Economy"
	if not Events.earned.is_connected(_on_earned): Events.earned.connect(_on_earned)
	if not Events.mission_completed.is_connected(_on_mission): Events.mission_completed.connect(_on_mission)
	if not Events.game_started.is_connected(_on_started): Events.game_started.connect(_on_started)

func _on_earned(_n: int) -> void: check_promotion()
func _on_mission(_m: Dictionary) -> void: check_promotion()
func _on_started(_new: bool) -> void: check_promotion(true)

# ------------------------------------------------------------------------------------------------------------------
# ranks
# ------------------------------------------------------------------------------------------------------------------
func rank() -> int: return int(Game.state.get("securityLevel", 1))
func rank_def(r: int = -1) -> Dictionary:
	if r < 0: r = rank()
	return Data.ranks.get(str(r), {})
func rank_title(r: int = -1) -> String: return str(rank_def(r).get("title", "Explorer"))
func max_rank() -> int:
	var m := 1
	for k in Data.ranks.values(): m = maxi(m, int(k.get("rank", 1)))
	return m
func earned() -> int: return int(Game.state.get("earned", 0))
func missions_completed() -> int:
	var c: Variant = Game.state.get("missions", {}).get("completed", [])
	return c.size() if c is Array else int(c)
func next_rank_def() -> Dictionary: return rank_def(rank() + 1)
## Progress toward the next grade for the terminal: { rank, title, next, earned, missions, earned_frac, missions_frac }
func rank_progress() -> Dictionary:
	var nxt := next_rank_def()
	var ef := 1.0; var mf := 1.0
	if not nxt.is_empty():
		ef = clampf(float(earned()) / maxf(1.0, float(nxt.get("earned", 1))), 0.0, 1.0)
		mf = clampf(float(missions_completed()) / maxf(1.0, float(nxt.get("missions", 1))), 0.0, 1.0)
	return { "rank": rank(), "title": rank_title(), "next": nxt, "earned": earned(), "missions": missions_completed(), "earned_frac": ef, "missions_frac": mf }
## Clearance is granted, never lowered. Returns the new rank (or the current one). Quiet on game start.
func check_promotion(quiet: bool = false) -> int:
	var want := Data.rank_for(earned(), missions_completed())
	if want <= rank(): return rank()
	Game.state["securityLevel"] = want
	var title := rank_title(want)
	if not quiet:
		Events.notice.emit("Clearance %d granted. Grade: %s. Requisition and contract tiers widened accordingly." % [want, title], "clearance")
		Audio.play("ui_stamp", null, 0.7)
	rank_changed.emit(want, title)
	return want

# ------------------------------------------------------------------------------------------------------------------
# supply crate
# ------------------------------------------------------------------------------------------------------------------
func shop_items(r: int = -1) -> Array: return Data.shop_items(rank() if r < 0 else r)
func category_of(id: String) -> String:
	var c := Data.category_of(id)
	return c
func lot_of(id: String) -> int: return AMMO_LOT if Data.ammo.has(id) else 1
func price_of(id: String, qty: int = -1) -> int:
	if qty < 0: qty = lot_of(id)
	return Data.price_of(id) * qty
## The whole catalogue by category, including grades above the current clearance (shown locked): { cat: [def] }
func catalogue() -> Dictionary:
	var by := {}
	for d in Data.shop_items(max_rank()):
		var k := category_of(str(d.get("id", "")))
		if not by.has(k): by[k] = []
		by[k].append(d)
	for k in by.keys(): by[k].sort_custom(func(a, b): return int(a.get("rank", 1)) < int(b.get("rank", 1)) or (int(a.get("rank", 1)) == int(b.get("rank", 1)) and int(a.get("price", 0)) < int(b.get("price", 0))))
	return by
func can_buy(id: String, qty: int = -1) -> Dictionary:
	var d := Data.def(id)
	if d.is_empty() or int(d.get("price", 0)) <= 0 or d.get("hidden", false) or str(d.get("kind", "")) in ["mission", "key", "artifact"]:
		return { "ok": false, "reason": "Not stocked." }
	if int(d.get("rank", 1)) > rank(): return { "ok": false, "reason": "Clearance %d required. Current clearance %d." % [int(d.get("rank", 1)), rank()] }
	var price := price_of(id, qty)
	if Game.inventory.money() < price: return { "ok": false, "reason": "Insufficient funds. %s required, %s on hand." % [money_text(price), money_text(Game.inventory.money())] }
	return { "ok": true, "reason": "", "price": price }
## Issue one lot. Returns { ok, text, price, entry }.
func buy(id: String, qty: int = -1) -> Dictionary:
	var chk := can_buy(id, qty)
	if not bool(chk["ok"]): Audio.play("ui_deny", null, 0.5); return { "ok": false, "text": chk["reason"], "price": 0 }
	if qty < 0: qty = lot_of(id)
	var d := Data.def(id); var inv: Inventory = Game.inventory
	var price := int(chk["price"])
	if not inv.spend(price): return { "ok": false, "text": "Insufficient funds.", "price": 0 }
	var what := ""; var entry := {}
	match category_of(id):
		"weapon":
			var w := Inventory.make_weapon(id); inv.add_weapon(w); entry = { "kind": "weapon", "id": id, "uid": w["uid"], "inst": w }
			what = "%s issued, %d rounds loaded." % [str(d.get("full", d.get("name", id))), Inventory.rounds_in(w)]
		"ammo":
			inv.add(id, qty); entry = { "kind": "item", "id": id, "count": qty }
			what = "%d rounds of %s issued." % [qty, str(d.get("name", id))]
		"mag":
			var m := Inventory.make_mag(id); inv.add_mag(m); entry = { "kind": "mag", "id": id, "uid": m["uid"], "inst": m }
			what = "%s issued, empty." % str(d.get("name", id))
		_:
			if _is_instance(d):
				var g := Inventory.make_gear(id); inv.add_gear(g); entry = { "kind": str(d.get("kind", "gear")), "id": id, "uid": g["uid"], "inst": g }
			else:
				inv.add(id, qty); entry = { "kind": "item", "id": id, "count": qty }
			what = "%s issued." % str(d.get("name", id))
	Audio.play("ui_buy", null, 0.5)
	var over := inv.overweight()
	var text := "%s %s deducted." % [what, money_text(price)]
	if over > 0.0: text += " Load exceeds capacity by %.1f kg." % over
	return { "ok": true, "text": text, "price": price, "entry": entry }

func _is_instance(d: Dictionary) -> bool:
	return str(d.get("kind", "")) in ["vest", "helmet", "backpack", "rig", "headgear", "mask", "melee"] or d.get("durability") != null or d.get("battery") != null or d.get("filter") != null or (d.get("uses") != null and str(d.get("kind", "")) == "melee")

## Buy-back for one list() entry: 40 % of list, condition-weighted (a gun at 30 % fetches about half of a new one).
func sell_price(entry: Dictionary, qty: int = -1) -> int:
	var id := str(entry.get("id", ""))
	var d := Data.def(id)
	if d.is_empty() or int(d.get("price", 0)) <= 0 or str(d.get("kind", "")) == "artifact": return 0
	match str(entry.get("kind", "")):
		"weapon":
			var w: Dictionary = entry.get("inst", {})
			var list := float(d.get("price", 0))
			for v in w.get("attachments", {}).values(): list += Data.price_of(str(v))
			for r in w.get("rails", []): list += Data.price_of(str(r))
			if w.get("mag") is Dictionary: list += Data.price_of(str(w["mag"].get("id", "")))
			return int(roundf(list * (0.5 + 0.5 * Inventory.condition(w)) * BUYBACK))
		"mag": return int(roundf(float(d.get("price", 0)) * BUYBACK))
		_:
			if entry.has("uid"):
				var g: Dictionary = entry.get("inst", {})
				var cond := 1.0
				if d.get("durability") != null: cond = 0.5 + 0.5 * clampf(float(g.get("durability", d["durability"])) / maxf(1.0, float(d["durability"])), 0.0, 1.0)
				return int(roundf(float(d.get("price", 0)) * cond * BUYBACK))
			if qty < 0: qty = mini(lot_of(id), int(entry.get("count", 1)))
			return int(roundf(float(d.get("price", 0)) * qty * BUYBACK))
## Return an entry to the crate. Weapons go with their attachments and inserted magazine; loaded rounds come back
## to the kit first. Returns { ok, text, price }.
func sell(entry: Dictionary, qty: int = -1) -> Dictionary:
	var inv: Inventory = Game.inventory
	var id := str(entry.get("id", "")); var d := Data.def(id)
	if str(d.get("kind", "")) == "artifact": return { "ok": false, "text": "Artifacts are submitted at the terminal.", "price": 0 }
	var price := sell_price(entry, qty)
	if price <= 0: Audio.play("ui_deny", null, 0.5); return { "ok": false, "text": "The crate does not take that back.", "price": 0 }
	var name := str(d.get("name", id))
	match str(entry.get("kind", "")):
		"weapon":
			var w: Variant = inv.weapon_by_uid(int(entry.get("uid", -1)))
			if w == null: return { "ok": false, "text": "Not carried.", "price": 0 }
			if w.get("mag") is Dictionary: inv.unload_mag(w["mag"])
			if w.get("chamber") != null: inv.add(str(w["chamber"]), 1); w["chamber"] = null
			for a in w.get("tube", []): inv.add(str(a), 1)
			w["tube"] = []
			inv.remove_weapon(int(w["uid"]))
			var n: int = w.get("attachments", {}).size() + w.get("rails", []).size()
			name = str(d.get("full", name)) + (" with %d attachment%s" % [n, "s" if n > 1 else ""] if n > 0 else "")
		"mag":
			var m: Variant = inv.mag_by_uid(int(entry.get("uid", -1)))
			if m == null: return { "ok": false, "text": "Not carried.", "price": 0 }
			inv.unload_mag(m); inv.remove_mag(int(m["uid"]))
		_:
			if entry.has("uid"):
				if inv.remove_gear(int(entry["uid"])) == null: return { "ok": false, "text": "Not carried.", "price": 0 }
			else:
				var q := mini(lot_of(id), inv.count(id)) if qty < 0 else mini(qty, inv.count(id))
				if q <= 0 or not inv.remove(id, q): return { "ok": false, "text": "Not carried.", "price": 0 }
				if q > 1: name = "%d rounds of %s" % [q, name] if Data.ammo.has(id) else "%d × %s" % [q, name]
	inv.earn(price)
	Audio.play("ui_buy", null, 0.5)
	return { "ok": true, "text": "%s returned. %s credited." % [name, money_text(price)], "price": price }

# ------------------------------------------------------------------------------------------------------------------
# terminal: artifacts and contract payments
# ------------------------------------------------------------------------------------------------------------------
func artifact_value(id: String) -> int:
	var d: Dictionary = Data.items.get(id, {})
	return int(d.get("price", 0)) if str(d.get("kind", "")) == "artifact" else 0
func sell_artifact(id: String, n: int = 1) -> Dictionary:
	var inv: Inventory = Game.inventory
	var v := artifact_value(id)
	if v <= 0 or n <= 0 or not inv.has(id, n): Audio.play("ui_deny", null, 0.5); return { "ok": false, "text": "Not carried.", "price": 0 }
	inv.remove(id, n)
	var price := v * n
	inv.earn(price)
	Game.state["stats"]["artifacts"] = int(Game.state["stats"].get("artifacts", 0)) + n
	Audio.play("ui_buy", null, 0.5)
	return { "ok": true, "text": "%s%s received. %s credited." % ["%d × " % n if n > 1 else "", Data.name_of(id), money_text(price)], "price": price }
func sell_all_artifacts() -> Dictionary:
	var total := 0; var n := 0
	for a in Game.inventory.artifacts():
		var r := sell_artifact(str(a["id"]), int(a["count"]))
		if bool(r["ok"]): total += int(r["price"]); n += int(a["count"])
	return { "ok": n > 0, "text": "%d artifact%s received. %s credited." % [n, "s" if n != 1 else "", money_text(total)], "price": total }
## Contract payment (the missions system calls this on delivery).
func pay_mission(m: Dictionary) -> int:
	var pay := int(m.get("payment", m.get("reward", 0)))
	if pay > 0: Game.inventory.earn(pay)
	return pay

static func money_text(n: int) -> String:
	var s := str(absi(n)); var out := ""
	while s.length() > 3:
		out = " " + s.substr(s.length() - 3) + out; s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out + " ₽"
