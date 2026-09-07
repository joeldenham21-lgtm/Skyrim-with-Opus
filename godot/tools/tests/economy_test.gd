extends SceneTree
## Economy tests: ranks and promotion notices, shop gating and issue, buy-back at 40 %, artifacts at full price at the
## terminal, and a simulated run-to-rank-2 with the loot tables. Run: $GODOT --headless --path . -s tools/tests/economy_test.gd
var G: Node
var D: Node
var E: Node
var Ec: Node
var Inv: GDScript
var fails := 0
var checks := 0
var notices: Array = []

func ok(cond: bool, what: String) -> void:
	checks += 1
	if not cond: fails += 1; print("  FAIL: ", what)
func eq(a: Variant, b: Variant, what: String) -> void:
	checks += 1
	if a != b: fails += 1; print("  FAIL: %s (got %s, want %s)" % [what, str(a), str(b)])

func _initialize() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)

func _run() -> void:
	G = root.get_node("Game"); D = root.get_node("Data"); E = root.get_node("Events")
	Inv = load("res://scripts/inventory/inventory.gd")
	G.state = G.default_state(); G._setup_systems(); G.set_mode("playing")
	Ec = G.economy
	E.notice.connect(func(text, kind): notices.append([text, kind]))
	test_ranks()
	test_shop()
	test_sell_back()
	test_artifacts()
	test_run_to_rank_2()
	print("[economy_test] %d checks, %d failures" % [checks, fails])
	quit(1 if fails > 0 else 0)

func inv():
	return G.inventory

func test_ranks() -> void:
	print("[economy_test] ranks")
	eq(Ec.rank(), 1, "start at clearance 1"); eq(Ec.rank_title(), "Explorer, provisional", "provisional")
	eq(D.rank_for(5999, 5), 1, "money alone is not enough"); eq(D.rank_for(6000, 1), 1, "contracts alone are not enough"); eq(D.rank_for(6000, 2), 2, "rank 2 at 6 000 and two contracts")
	eq(D.rank_for(18000, 6), 3, "rank 3"); eq(D.rank_for(45000, 12), 4, "rank 4"); eq(D.rank_for(100000, 20), 5, "rank 5"); eq(D.rank_for(1000000, 0), 1, "rich but idle")
	eq(Ec.max_rank(), 5, "five grades")
	notices.clear()
	inv().earn(6000)
	eq(Ec.rank(), 1, "no contracts yet: still 1")
	G.state["missions"]["completed"] = [{ "code": "PSC-0417" }, { "code": "PSC-0418" }]
	E.mission_completed.emit({ "code": "PSC-0418" })
	eq(Ec.rank(), 2, "promoted on the second contract")
	ok(notices.size() == 1 and notices[0][1] == "clearance" and str(notices[0][0]).begins_with("Clearance 2 granted. Grade: Explorer."), "Committee notice: %s" % (notices[0][0] if notices.size() else "none"))
	var p: Dictionary = Ec.rank_progress()
	eq(int(p["next"]["rank"]), 3, "next grade listed"); ok(float(p["earned_frac"]) > 0.3 and float(p["earned_frac"]) < 0.4, "progress fraction")
	G.state["earned"] = 0
	eq(Ec.check_promotion(), 2, "clearance is never lowered")
	G.state["earned"] = 6000

func test_shop() -> void:
	print("[economy_test] supply crate")
	var i = inv()
	G.state["money"] = 3000
	var r1: Array = Ec.shop_items(1); var r2: Array = Ec.shop_items(2); var r5: Array = Ec.shop_items(5)
	ok(r1.size() > 20 and r2.size() > r1.size() and r5.size() > r2.size(), "the catalogue widens with clearance: %d / %d / %d" % [r1.size(), r2.size(), r5.size()])
	for d in r5: ok(int(d.get("price", 0)) > 0 and not (str(d.get("kind", "")) in ["artifact", "mission", "key"]) and not d.get("hidden", false), "nothing unsellable in the shop: %s" % d.get("id"))
	var cat: Dictionary = Ec.catalogue()
	ok(cat.has("weapon") and cat.has("ammo") and cat.has("armor") and cat.has("med"), "catalogue categories: %s" % str(cat.keys()))
	ok(not Ec.can_buy("svd")["ok"] and str(Ec.can_buy("svd")["reason"]).begins_with("Clearance 3 required"), "SVD gated: %s" % Ec.can_buy("svd")["reason"])
	ok(Ec.can_buy("akm")["ok"], "AKM open at clearance 2")
	ok(not Ec.can_buy("art_pearl")["ok"] and not Ec.can_buy("torch")["ok"] and not Ec.can_buy("key_locker")["ok"], "artifacts, hidden items and keys are not stocked")
	var money0: int = i.money(); var w0: int = i.weapons.size()
	var r: Dictionary = Ec.buy("akm")
	ok(r["ok"], "bought an AKM: %s" % r["text"]); eq(i.money(), money0 - 2400, "2 400 deducted"); eq(i.weapons.size(), w0 + 1, "issued")
	var w: Dictionary = r["entry"]["inst"]
	eq(Inv.rounds_in(w), 31, "issued loaded 30 + 1"); ok(str(r["text"]).find("31 rounds loaded") >= 0, "text says so")
	r = Ec.buy("762_fmj"); ok(r["ok"], "ammo lot"); eq(i.count("762_fmj"), 10, "ten rounds"); eq(i.money(), money0 - 2400 - 140, "14 a round")
	r = Ec.buy("mag_ak762_30"); ok(r["ok"] and int(r["entry"]["inst"]["rounds"]) == 0, "magazine issued empty")
	r = Ec.buy("vest_paca"); ok(not r["ok"] and str(r["text"]).begins_with("Insufficient funds"), "cannot afford the PACA: %s" % r["text"])
	G.state["money"] = 20000
	r = Ec.buy("vest_paca"); ok(r["ok"] and r["entry"]["kind"] == "vest" and float(r["entry"]["inst"]["durability"]) == 60.0, "vest issued at full durability")
	r = Ec.buy("head_lamp"); ok(r["ok"] and float(r["entry"]["inst"]["charge"]) == 100.0, "headlamp issued charged")
	r = Ec.buy("bandage"); ok(r["ok"] and i.count("bandage") == 3, "a bandage");
	r = Ec.buy("knife"); ok(r["ok"] and r["entry"].has("uid"), "a knife is an instance")
	ok(i.overweight() == 0.0 or str(Ec.buy("bandage")["text"]).find("Load exceeds") >= 0, "overweight warning when it applies")

func test_sell_back() -> void:
	print("[economy_test] buy-back at 40 %")
	var i = inv()
	var list: Array = i.list()
	var akm := {}; var pm := {}; var mag := {}; var vest := {}
	for e in list:
		if e["kind"] == "weapon" and e["id"] == "akm": akm = e
		if e["kind"] == "weapon" and e["id"] == "pm": pm = e
		if e["kind"] == "mag" and e["id"] == "mag_ak762_30" and int(e["inst"]["rounds"]) == 0: mag = e
		if e["kind"] == "vest": vest = e
	eq(Ec.sell_price(pm), int(roundf((380 + 40) * 0.4)), "PM with its magazine, new: 40 % of 420")
	var w: Dictionary = akm["inst"]
	w["parts"] = { "barrel": 40.0, "bolt": 40.0, "frame": 40.0 }
	Inv.attach(w, "opt_kobra")
	eq(Ec.sell_price(akm), int(roundf((2400 + 1400 + 160) * (0.5 + 0.5 * 0.4) * 0.4)), "worn AKM with a Kobra and a magazine, condition-weighted")
	var money0: int = i.money(); var loose0: int = i.count("762_fmj")
	var r: Dictionary = Ec.sell(akm)
	ok(r["ok"], "sold: %s" % r["text"]); eq(i.money(), money0 + int(r["price"]), "credited"); ok(i.weapon_by_uid(int(akm["uid"])) == null, "gone")
	eq(i.count("762_fmj"), loose0 + 31, "31 loaded rounds returned to the kit first")
	eq(Ec.sell_price(mag), 64, "magazine at 40 % of 160"); ok(Ec.sell(mag)["ok"], "sold the magazine")
	vest["inst"]["durability"] = 30.0
	eq(Ec.sell_price(vest), int(roundf(1800 * (0.5 + 0.5 * 0.5) * 0.4)), "half-worn PACA")
	ok(Ec.sell(vest)["ok"] and i.equipped("vest") == null, "sold the vest off the back")
	var ammo_entry := { "kind": "item", "id": "762_fmj", "count": i.count("762_fmj") }
	eq(Ec.sell_price(ammo_entry), int(roundf(14 * 10 * 0.4)), "rounds go back ten at a time")
	var n0: int = i.count("762_fmj"); ok(Ec.sell(ammo_entry)["ok"], "sold ten rounds"); eq(i.count("762_fmj"), n0 - 10, "ten fewer")
	ok(not Ec.sell({ "kind": "item", "id": "recorder", "count": 1 })["ok"], "Committee property is not bought back")
	ok(Ec.sell_price({ "kind": "item", "id": "art_pearl", "count": 1 }) == 0 and not Ec.sell({ "kind": "item", "id": "art_pearl", "count": 1 })["ok"], "artifacts are refused at the crate")
	ok(int(G.state["earned"]) > 6000, "sales count as earnings")

func test_artifacts() -> void:
	print("[economy_test] artifacts at the terminal")
	var i = inv()
	i.add("art_pearl", 2); i.add("art_heart", 1)
	var arts: Array = i.artifacts(); eq(arts.size(), 2, "two kinds carried")
	eq(Ec.artifact_value("art_heart"), 7200, "Heart lists at 7 200"); eq(Ec.artifact_value("bandage"), 0, "a bandage is not an artifact")
	var money0: int = i.money(); var earned0: int = G.state["earned"]
	var r: Dictionary = Ec.sell_artifact("art_pearl", 1)
	ok(r["ok"] and int(r["price"]) == 1400, "Pearl at full price: %s" % r["text"]); eq(i.money(), money0 + 1400, "credited in full"); eq(i.count("art_pearl"), 1, "one left")
	eq(int(G.state["stats"]["artifacts"]), 1, "stat counted")
	ok(not Ec.sell_artifact("art_pearl", 5)["ok"], "cannot submit more than carried")
	r = Ec.sell_all_artifacts(); ok(r["ok"] and int(r["price"]) == 1400 + 7200, "all in: %s" % r["text"]); eq(i.artifacts().size(), 0, "none left")
	eq(int(G.state["earned"]), earned0 + 1400 + 8600, "earnings track artifacts")
	eq(Ec.pay_mission({ "code": "PSC-0417", "payment": 1200 }), 1200, "contract paid"); eq(i.money(), money0 + 1400 + 8600 + 1200, "money after the contract")

func test_run_to_rank_2() -> void:
	print("[economy_test] simulated runs: starter kit to clearance 2")
	# A "good run": two POIs at tier 1, six containers, one artifact found near an anomaly field, one level-1 contract
	# (~1 300 ₽ with the distance factor). Everything found is sold at the crate (40 %), the artifact at the terminal.
	var L: Node = G.loot
	var rng := RandomNumberGenerator.new(); rng.seed = 2024
	var runs_needed := []
	for trial in 200:
		var earned := 0.0; var missions := 0; var runs := 0
		while runs < 12:
			runs += 1
			var run_value := 0.0
			for c in 6:
				var poi_kind: String = ["checkpoint", "convoy", "village"][rng.randi_range(0, 2)]
				var kind: String = ["crate", "bag", "cabinet", "desk", "shelf"][rng.randi_range(0, 4)]
				for e in L.roll_container(kind, 1, poi_kind, rng):
					var d: Dictionary = D.def(str(e["id"])); var p := float(d.get("price", 0))
					if str(d.get("kind", "")) == "artifact": run_value += p
					elif str(e.get("kind", "")) == "weapon": run_value += p * 0.4 * (0.5 + 0.5 * Inv.condition(e["inst"]))
					elif str(e.get("kind", "")) == "gear":
						var dur := float(e["inst"].get("durability", d.get("durability", 1)))
						run_value += p * 0.4 * (0.5 + 0.5 * dur / maxf(1.0, float(d.get("durability", 1))))
					else: run_value += p * 0.4 * int(e.get("count", 1))
			# the artifact: pearls and embers at the near fields, a tear one time in four
			run_value += [1400, 1900, 1400, 2600][rng.randi_range(0, 3)]
			# one contract and its pay; spend a third of the take on ammunition and meds for the next run
			run_value += 1300; missions += 1
			earned += run_value
			if earned >= 6000 and missions >= 2: break
		runs_needed.append(runs)
	runs_needed.sort()
	var median: int = runs_needed[runs_needed.size() / 2]; var worst: int = runs_needed[runs_needed.size() - 1]
	print("  runs to clearance 2: median %d, worst of 200 trials %d" % [median, worst])
	ok(median >= 2 and median <= 3, "a couple of good runs reach clearance 2 (median %d)" % median)
	ok(worst <= 4, "never more than four (worst %d)" % worst)
	# ammunition economy: what a tier-1 tin is worth against the crate's price for the same rounds
	var rounds := 0.0; var cost := 0.0
	for k in 2000:
		for e in L.roll_container("ammo_tin", 1, "", rng):
			if D.ammo.has(str(e["id"])): rounds += int(e["count"]); cost += int(e["count"]) * float(D.ammo[e["id"]]["price"])
	print("  ammo tin at tier 1: %.1f rounds worth %.0f ₽ at list per tin" % [rounds / 2000, cost / 2000])
	ok(rounds / 2000 > 8.0 and rounds / 2000 < 32.0, "tins hold a part-magazine, not a crate")
