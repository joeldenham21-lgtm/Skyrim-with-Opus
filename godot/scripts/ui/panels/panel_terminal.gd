extends RadiusPanel
## Form 61-T — UNPSC Terminal 3 at Vanno. Contracts are taken and closed here, artifacts are submitted here at
## full listed price, and clearance is granted here. The Committee's notice board sits under the contract list and
## is always current: the Tide, the grade the Explorer is working toward, and the standing orders.
## The missions module is optional: when it is absent the board still reads, and the terminal says so plainly.

const TABS := [["missions", "Contracts"], ["artifacts", "Artifacts"], ["status", "Status"]]
const ABANDON_RATE := 0.1

var tab := "missions"
var confirm := ""

func panel_id() -> String: return "terminal"
func title_text() -> String: return "Vanno · UNPSC Terminal 3"
func form_code() -> String: return "61-T"
func key_hint() -> String: return "Esc close · arrows move · Enter confirm · 1-3 headings"
func sheet_size(vp: Vector2) -> Vector2:
	return Vector2(minf(vp.x - 90.0, 1300.0), minf(vp.y - 60.0, 940.0))

func on_open() -> void:
	if str(data.get("tab", "")) != "": tab = str(data["tab"])
	_check_promotion()

# ------------------------------------------------------------------------------------------------------------------
# the missions module, read defensively
# ------------------------------------------------------------------------------------------------------------------
func _missions() -> Node:
	var m: Variant = Game.get("missions")
	if m != null and m is Node and is_instance_valid(m): return m
	var n := Game.get_node_or_null("Missions")
	return n

func _active() -> Array:
	var m := _missions()
	if m != null and "active" in m:
		var a: Variant = m.get("active")
		if a is Array: return a
		if a is Dictionary: return [a]
	var st: Variant = Game.state.get("missions", {}).get("active", [])
	return st if st is Array else []

func _available() -> Array:
	var m := _missions()
	if m != null and m.has_method("available"):
		var a: Variant = m.available()
		if a is Array: return a
	var st: Variant = Game.state.get("missions", {}).get("available", [])
	return st if st is Array else []

func _completed() -> int:
	var c: Variant = Game.state.get("missions", {}).get("completed", [])
	if c is Array: return c.size()
	return int(c) if c != null else 0

func _deliverable(m: Dictionary) -> bool:
	var mod := _missions()
	if mod != null and mod.has_method("deliverable"): return bool(mod.deliverable(m))
	return str(m.get("status", "")) in ["complete", "ready"]

# ------------------------------------------------------------------------------------------------------------------
func build() -> void:
	add_child(_greeting())
	add_child(PaperUI.spacer(8))
	var counts := [["missions", "Contracts", str(_active().size() + _available().size())],
		["artifacts", "Artifacts", str(inv().artifacts().size()) if has_inv() else ""],
		["status", "Status", ""]]
	add_child(PaperUI.tabs(counts, tab, _pick_tab))
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	add_child(sc)
	match tab:
		"artifacts": _artifacts(v)
		"status": _status(v)
		_: _contracts(v)

func _greeting() -> Control:
	var h := PaperUI.rowbox(16)
	h.custom_minimum_size = Vector2(0, 22)
	h.add_child(PaperUI.caps("Vanno Outpost · UNPSC Terminal 3 · Explorer %d · Security level %d" % [int(Game.state.get("explorer", 61)), rank()], Paper.S_MICRO, Paper.ink(0.66)))
	h.add_child(PaperUI.stretch())
	h.add_child(PaperUI.caps(rank_title(), Paper.S_MICRO, Paper.AMBER))
	return h

# ------------------------------------------------------------------------------------------------------------------
# contracts
# ------------------------------------------------------------------------------------------------------------------
func _penalty(m: Dictionary) -> int:
	return int(roundf(float(m.get("payment", m.get("reward", 0))) * ABANDON_RATE / 50.0)) * 50

func _progress_text(m: Dictionary) -> String:
	if _deliverable(m): return "ready for delivery"
	var t := str(m.get("type", "")).to_upper()
	if t == "CLEARANCE" and m.get("count") != null:
		return "%d / %d destroyed" % [int(m.get("kills", 0)), int(m["count"])]
	if m.get("points") is Array:
		var done := 0
		for p in m["points"]: if bool(p.get("done", false)): done += 1
		return "%d / %d beacons planted" % [done, m["points"].size()]
	if t == "RETRIEVAL": return "object in hand" if bool(m.get("recovered", false)) else "object outstanding"
	if t == "ARTIFACT":
		var aid := str(m.get("artifact", ""))
		return "artifact in hand" if (has_inv() and inv().has(aid)) else "artifact outstanding"
	return "in progress"

func _contract_block(m: Dictionary, active: bool) -> Control:
	var v := PaperUI.column(0)
	v.add_child(PaperUI.spacer(10))
	var code := str(m.get("code", m.get("id", "PSC-0000")))
	var title := str(m.get("title", m.get("name", "")))
	var head := PaperUI.rowbox(10)
	head.add_child(PaperUI.caps(code + (" / " + title if title != "" else ""), Paper.S_TINY, Paper.INK, true))
	head.add_child(PaperUI.stretch())
	if active:
		var ready := _deliverable(m)
		head.add_child(PaperUI.caps(_progress_text(m), Paper.S_MICRO, Paper.AMBER if ready else Paper.ink(0.55)))
	v.add_child(head)
	v.add_child(PaperUI.spacer(3))
	var body := str(m.get("body", m.get("text", m.get("desc", ""))))
	var pay_line := ""
	var idx := body.rfind("Payment ")
	if idx >= 0:
		pay_line = body.substr(idx).strip_edges()
		body = body.substr(0, idx).strip_edges()
	if body != "": v.add_child(PaperUI.para(body, Paper.S_SMALL, Paper.ink(0.74)))
	if m.get("requirements") is Array and not m["requirements"].is_empty():
		var reqs: Array = []
		for r in m["requirements"]: reqs.append(str(r))
		v.add_child(PaperUI.spacer(2))
		v.add_child(PaperUI.label(" · ".join(reqs), Paper.S_TINY, Paper.ink(0.55)))
	v.add_child(PaperUI.spacer(6))
	var foot := PaperUI.rowbox(10)
	foot.custom_minimum_size = Vector2(0, 30)
	var pay := int(m.get("payment", m.get("reward", 0)))
	foot.add_child(PaperUI.label(pay_line if pay_line != "" else "Payment %s on delivery." % Paper.money(pay), Paper.S_SMALL, Paper.ink(0.78)))
	foot.add_child(PaperUI.stretch())
	var id := str(m.get("id", code))
	if not active:
		foot.add_child(PaperUI.act("Accept", _accept.bind(id)))
	elif confirm == id:
		foot.add_child(PaperUI.act("Confirm · charge %s" % Paper.money(_penalty(m)), _abandon.bind(id), { "deny": true }))
		foot.add_child(PaperUI.act("Keep it", _keep))
	else:
		if _deliverable(m): foot.add_child(PaperUI.act("Deliver", _deliver.bind(id)))
		foot.add_child(PaperUI.act("Abandon", _abandon.bind(id)))
	v.add_child(foot)
	if active and confirm == id:
		v.add_child(PaperUI.para("Abandonment is recorded against the Explorer. %s is charged to contract funds and issued items are withdrawn." % Paper.money(_penalty(m)), Paper.S_TINY, Paper.RED))
	v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.22)))
	return v

func _contracts(v: VBoxContainer) -> void:
	var active := _active()
	var avail: Array = []
	for m in _available():
		var dup := false
		for a in active:
			if str(a.get("id", "")) == str(m.get("id", "")): dup = true
		if not dup: avail.append(m)
	v.add_child(PaperUI.section("Active contracts", str(active.size()) if not active.is_empty() else ""))
	if active.is_empty(): v.add_child(PaperUI.empty("No contract active."))
	for m in active: v.add_child(_contract_block(m, true))
	v.add_child(PaperUI.section("Posted", str(avail.size()) if not avail.is_empty() else ""))
	if avail.is_empty():
		v.add_child(PaperUI.empty("No contracts posted. The board is updated after each Tide." if _missions() != null
			else "The contract board is not reachable from this terminal. Notices below are current."))
	for m in avail: v.add_child(_contract_block(m, false))
	_notice_board(v)

## The Committee's board: always current, always in the register.
func _notice_board(v: VBoxContainer) -> void:
	v.add_child(PaperUI.section("Committee notices", "Vanno"))
	for n in _notices():
		var b := PaperUI.column(0)
		b.add_child(PaperUI.spacer(6))
		var h := PaperUI.rowbox(10)
		h.add_child(PaperUI.caps(str(n[0]), Paper.S_MICRO, Paper.AMBER, true))
		h.add_child(PaperUI.stretch())
		h.add_child(PaperUI.caps(str(n[2]), Paper.S_MICRO, Paper.ink(0.45)))
		b.add_child(h)
		b.add_child(PaperUI.spacer(2))
		b.add_child(PaperUI.para(str(n[1]), Paper.S_SMALL, Paper.ink(0.70)))
		b.add_child(PaperUI.spacer(4))
		b.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
		v.add_child(b)

func _notices() -> Array:
	var st: Dictionary = Game.state
	var out: Array = []
	var tide := Clock.tide_in()
	var tide_line := "The Tide is expected at 05:00 on day %d, in %s. Every explorer is to be inside a bunker at the hour. Anything left in the Radius is not recovered." % [Clock.tide_day, Paper.span(tide)]
	if tide < 3600.0:
		tide_line = "TIDE IMMINENT. Return to Vanno. The siren sounds from the base at sixty minutes. Nothing outside a bunker is recovered."
	out.append(["Notice 61/1 · Tide schedule", tide_line, "day %d" % Clock.day])
	var nxt: Dictionary = Data.ranks.get(str(rank() + 1), {})
	if nxt.is_empty():
		out.append(["Notice 61/2 · Clearance", "Explorer %d holds the maximum clearance on file. No further grades are conferred at this station." % int(st.get("explorer", 61)), "grade %d" % rank()])
	else:
		out.append(["Notice 61/2 · Clearance", "Grade %s is conferred at %s earned and %d contracts concluded. On file: %s and %d. Requisition and contract tiers widen with the grade." % [
			str(nxt.get("title", "")), Paper.money(int(nxt.get("earned", 0))), int(nxt.get("missions", 0)),
			Paper.money(int(st.get("earned", 0))), _completed()], "grade %d" % rank()])
	var lvl := int(st.get("tideLevel", 1))
	if lvl >= 2:
		out.append(["Notice 61/3 · Anomalous activity", "Activity index raised to %d after the last Tide. Entities of class Seeker are reported at Object 12 and the church. Engagement is at the Explorer's discretion; the Committee does not insure it." % lvl, "index %d" % lvl])
	else:
		out.append(["Notice 61/3 · Standing orders", "Probes are issued for a reason: throw before you walk. Artifacts are submitted at this terminal and nowhere else. Anything on the Explorer's person is forfeit on incident; the locker is not subject to the Tide.", "standing"])
	return out

# ------------------------------------------------------------------------------------------------------------------
# artifacts
# ------------------------------------------------------------------------------------------------------------------
func _artifacts(v: VBoxContainer) -> void:
	if not has_inv():
		v.add_child(PaperUI.empty("No kit on file.")); return
	var arts: Array = inv().artifacts()
	var total := 0
	for a in arts: total += int(a["count"]) * int(a["def"].get("price", 0))
	v.add_child(PaperUI.section("Artifacts · Committee purchase", str(arts.size()) if not arts.is_empty() else ""))
	if arts.is_empty():
		v.add_child(PaperUI.empty("Nothing to submit. Artifacts lie near anomalies and are found with a detector."))
	for a in arts:
		var d: Dictionary = a["def"]
		var n := int(a["count"])
		var id := str(a["id"])
		var acts: Array = [PaperUI.act("Submit", _sell_artifact.bind(id, 1))]
		if n > 1: acts.append(PaperUI.act("All %d" % n, _sell_artifact.bind(id, n)))
		v.add_child(PaperUI.row(PaperUI.name_block(str(d.get("name", id)), str(d.get("desc", "Committee note pending.")),
			[["× %d" % n, Paper.ink(0.55)]] if n > 1 else []),
			PaperUI.number(Paper.money_num(int(d.get("price", 0)) * n), "RUB", Paper.AMBER), acts))
	if not arts.is_empty():
		v.add_child(PaperUI.spacer(8))
		v.add_child(PaperUI.row(PaperUI.name_block("Declared value", "at full listed price"),
			PaperUI.number(Paper.money_num(total), "RUB", Paper.AMBER), [PaperUI.act("Submit all", _sell_all)]))
	v.add_child(PaperUI.note("Purchased at full listed price; the supply crate does not take artifacts. Submissions count toward clearance."))

func _sell_artifact(id: String, n: int) -> void:
	var e: Node = economy()
	if e != null and e.has_method("sell_artifact"):
		var r: Dictionary = e.sell_artifact(id, n)
		if not bool(r.get("ok", false)): deny(str(r.get("text", "Not carried."))); return
		notice(str(r.get("text", "")))
	else:
		var i: Inventory = inv()
		var d: Dictionary = Data.items.get(id, {})
		if str(d.get("kind", "")) != "artifact" or not i.has(id, n): deny("Not carried."); return
		i.remove(id, n)
		var price := int(d.get("price", 0)) * n
		i.earn(price)
		Game.state["stats"]["artifacts"] = int(Game.state["stats"].get("artifacts", 0)) + n
		notice("%s%s received. %s credited." % ["%d × " % n if n > 1 else "", str(d.get("name", id)), Paper.money(price)])
	snd("ui_buy", 0.55)
	_check_promotion()
	refresh()

func _sell_all() -> void:
	var e: Node = economy()
	if e != null and e.has_method("sell_all_artifacts"):
		var r: Dictionary = e.sell_all_artifacts()
		if not bool(r.get("ok", false)): deny("Nothing to submit."); return
		notice(str(r.get("text", "")))
		snd("ui_buy", 0.6); _check_promotion(); refresh(); return
	var arts: Array = inv().artifacts()
	if arts.is_empty(): deny("Nothing to submit."); return
	for a in arts: _sell_artifact(str(a["id"]), int(a["count"]))

# ------------------------------------------------------------------------------------------------------------------
# status
# ------------------------------------------------------------------------------------------------------------------
func _status(v: VBoxContainer) -> void:
	var st: Dictionary = Game.state
	var lvl := rank()
	var cur: Dictionary = Data.ranks.get(str(lvl), {})
	var nxt: Dictionary = Data.ranks.get(str(lvl + 1), {})
	var done := _completed()
	v.add_child(PaperUI.section("Clearance"))
	var head := PaperUI.rowbox(14)
	head.custom_minimum_size = Vector2(0, 46)
	var big := PaperUI.label(str(lvl), 40, Paper.INK, "display_wide_med")
	big.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(big)
	var side := PaperUI.column(1)
	side.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	side.add_child(PaperUI.label(str(cur.get("title", rank_title())), Paper.S_BODY, Paper.INK, "mono_med"))
	side.add_child(PaperUI.label("clearance %d of %d%s" % [lvl, Data.ranks.size(),
		(" · next grade: %s" % str(nxt.get("title", ""))) if not nxt.is_empty() else " · maximum clearance"], Paper.S_TINY, Paper.ink(0.58)))
	head.add_child(side)
	head.add_child(PaperUI.stretch())
	if not nxt.is_empty():
		head.add_child(PaperUI.stamp("Grade %d" % lvl, Paper.AMBER, -5.0, 13))
	else:
		head.add_child(PaperUI.stamp("Maximum", Paper.AMBER, -5.0, 13))
	v.add_child(head)
	if not nxt.is_empty():
		var earned := int(st.get("earned", 0))
		var need_e := int(nxt.get("earned", 1))
		var need_m := int(nxt.get("missions", 0))
		var base_e := int(cur.get("earned", 0))
		var base_m := int(cur.get("missions", 0))
		v.add_child(PaperUI.row(PaperUI.name_block("Earned toward clearance %d" % (lvl + 1)),
			PaperUI.number("%s / %s" % [Paper.money_num(earned), Paper.money_num(need_e)], "RUB")))
		v.add_child(PaperUI.Bar.new(clampf(float(earned - base_e) / maxf(1.0, float(need_e - base_e)), 0.0, 1.0), Paper.AMBER, 4.0))
		v.add_child(PaperUI.spacer(8))
		v.add_child(PaperUI.row(PaperUI.name_block("Contracts toward clearance %d" % (lvl + 1)),
			PaperUI.number("%d / %d" % [done, need_m], "closed")))
		v.add_child(PaperUI.Bar.new(clampf(float(done - base_m) / maxf(1.0, float(need_m - base_m)), 0.0, 1.0), Paper.AMBER, 4.0))
		v.add_child(PaperUI.spacer(8))
	v.add_child(PaperUI.kv("Earned to date", Paper.money(int(st.get("earned", 0)))))
	v.add_child(PaperUI.kv("Contract funds", Paper.money(money())))
	v.add_child(PaperUI.kv("Contracts concluded", str(done)))
	v.add_child(PaperUI.section("Grades"))
	var keys: Array = Data.ranks.keys()
	keys.sort()
	for k in keys:
		var r: Dictionary = Data.ranks[k]
		var held := int(r.get("rank", 1)) <= lvl
		v.add_child(PaperUI.row(PaperUI.name_block("%d · %s" % [int(r.get("rank", 1)), str(r.get("title", ""))], "",
			[["held", Paper.AMBER]] if held else []),
			PaperUI.number("%s · %d contracts" % [Paper.money(int(r.get("earned", 0))), int(r.get("missions", 0))], ""), [], not held))
	v.add_child(PaperUI.section("Field record"))
	var stats: Dictionary = st.get("stats", {})
	v.add_child(PaperUI.kv("Entities neutralised", str(int(stats.get("kills", 0)))))
	v.add_child(PaperUI.kv("Artifacts recovered", str(int(stats.get("artifacts", 0)))))
	v.add_child(PaperUI.kv("Rounds expended", str(int(stats.get("shots", 0)))))
	v.add_child(PaperUI.kv("Distance walked", "%s km" % String.num(float(stats.get("distance", 0.0)) / 1000.0, 1)))
	v.add_child(PaperUI.kv("Tides survived", str(int(stats.get("tides", 0)))))
	v.add_child(PaperUI.kv("Incidents on file", str(int(stats.get("deaths", 0)))))
	v.add_child(PaperUI.note("Clearance governs requisition and contract tiers. Grades are conferred at this terminal on the strength of earnings and contracts concluded."))

# ------------------------------------------------------------------------------------------------------------------
# actions
# ------------------------------------------------------------------------------------------------------------------
func _pick_tab(id: String) -> void:
	tab = id
	confirm = ""
	snd("ui_tab", 0.4)
	refresh()

func _check_promotion() -> void:
	var e: Node = economy()
	if e != null and e.has_method("check_promotion"): e.check_promotion()

func _find(list: Array, id: String) -> Dictionary:
	for m in list:
		if str(m.get("id", m.get("code", ""))) == id: return m
	return {}

func _accept(id: String) -> void:
	var mod := _missions()
	var m := _find(_available(), id)
	if m.is_empty(): return
	if mod != null and mod.has_method("accept"):
		if mod.accept(id) == false:
			deny("%s not issued. Two contracts may be open at once; conclude one first." % str(m.get("code", id))); return
	else:
		var md: Dictionary = Game.state.get("missions", {})
		if not (md.get("active") is Array): md["active"] = []
		if md["active"].size() >= 2:
			deny("Two contracts may be open at once; conclude one first."); return
		md["active"].append(m)
		Events.mission_accepted.emit(m)
	notice("%s accepted. Terms on file." % str(m.get("code", id)))
	snd("ui_stamp", 0.6)
	refresh()

func _deliver(id: String) -> void:
	var mod := _missions()
	var m := _find(_active(), id)
	if m.is_empty(): return
	if mod != null and mod.has_method("complete"):
		if mod.complete(id) == false:
			deny("%s: conditions not met. See the terms." % str(m.get("code", id))); return
	else:
		deny("Delivery is recorded by the duty officer, not this terminal."); return
	notice("%s closed. %s credited." % [str(m.get("code", id)), Paper.money(int(m.get("payment", 0)))])
	snd("ui_stamp", 0.6)
	_check_promotion()
	refresh()

func _abandon(id: String) -> void:
	var m := _find(_active(), id)
	if m.is_empty(): return
	if confirm != id:
		confirm = id
		snd("ui_click", 0.4)
		refresh(); return
	confirm = ""
	var mod := _missions()
	var ok := false
	if mod != null and mod.has_method("abandon"): ok = mod.abandon(id) != false
	else:
		var md: Dictionary = Game.state.get("missions", {})
		if md.get("active") is Array:
			for k in md["active"].size():
				if str(md["active"][k].get("id", "")) == id:
					md["active"].remove_at(k); ok = true; break
		if ok: Events.mission_failed.emit(m)
	if not ok:
		deny("%s cannot be withdrawn here." % str(m.get("code", id))); return
	var pen := _penalty(m)
	Game.state["money"] = maxi(0, money() - pen)
	Events.notice.emit("Contract %s abandoned. %s charged. Noted on file." % [str(m.get("code", id)), Paper.money(pen)], "terminal")
	notice("%s withdrawn. %s charged." % [str(m.get("code", id)), Paper.money(pen)], true)
	snd("ui_stamp", 0.55)
	refresh()

func _keep() -> void:
	confirm = ""
	snd("ui_click", 0.4)
	refresh()
