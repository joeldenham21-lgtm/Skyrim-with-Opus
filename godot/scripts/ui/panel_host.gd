class_name PanelHost
extends CanvasLayer
## The desk. One sheet at a time, laid over the frozen world.
##   Events.open_panel(name, data) puts a form down: the world pauses (Game.set_mode("paused")), the pointer is
##   freed, the sheet settles in, and the panel's own key or Escape puts it away again (Events.close_panel).
## The host owns the chrome every form shares — the header line (form, explorer, funds, load, day/time/Tide), the
## notice line and the key legend — so the panels only build their body.
## Install it once, from anywhere: PanelHost.ensure(get_tree()). Idempotent.

const PANEL_SCRIPTS := {
	"inventory": "res://scripts/ui/panels/panel_inventory.gd",
	"workbench": "res://scripts/ui/panels/panel_workbench.gd",
	"loot": "res://scripts/ui/panels/panel_loot.gd",
	"supply": "res://scripts/ui/panels/panel_supply.gd",
	"terminal": "res://scripts/ui/panels/panel_terminal.gd",
	"storage": "res://scripts/ui/panels/panel_storage.gd",
	"map": "res://scripts/ui/panels/panel_map.gd",
	"bed": "res://scripts/ui/panels/panel_bed.gd",
	"death": "res://scripts/ui/panels/panel_death.gd",
}
const GROUP := "panel_host"

signal opened(name: String)
signal closed()

var current := ""
var panel: RadiusPanel = null
var is_open := false
var locked := false                     # a panel job in progress: no close, no re-open

var _root: Control
var _scrim: ColorRect
var _shadow: Panel
var _frame: Control
var _stock: Control
var _stack: VBoxContainer
var _header: HBoxContainer
var _head_rule: PaperUI.Rule
var _body: MarginContainer
var _notice: Label
var _foot_rule: PaperUI.Rule
var _footer: HBoxContainer
var _mode_before := "playing"
var _notice_text := ""
var _notice_red := false
var _discover_t := 0.0

## Add a host to the scene tree if there is not one already.
static func ensure(tree: SceneTree) -> PanelHost:
	if tree == null: return null
	var found := tree.get_nodes_in_group(GROUP)
	for n in found:
		if n is PanelHost and is_instance_valid(n): return n
	var h := PanelHost.new()
	h.name = "PanelHost"
	var parent: Node = tree.current_scene if tree.current_scene != null else tree.root
	parent.add_child(h)
	return h

func _ready() -> void:
	add_to_group(GROUP)
	layer = 24
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_chrome()
	_root.visible = false
	if not Events.open_panel.is_connected(_on_open_panel): Events.open_panel.connect(_on_open_panel)
	if not Events.close_panel.is_connected(_on_close_panel): Events.close_panel.connect(_on_close_panel)
	if not Events.player_died.is_connected(_on_player_died): Events.player_died.connect(_on_player_died)
	if not Events.game_started.is_connected(_on_game_started): Events.game_started.connect(_on_game_started)
	get_viewport().size_changed.connect(_layout)

# ------------------------------------------------------------------------------------------------------------------
# chrome
# ------------------------------------------------------------------------------------------------------------------
func _build_chrome() -> void:
	_root = Control.new()
	_root.name = "Desk"
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.theme = Paper.theme()
	add_child(_root)

	_scrim = ColorRect.new()
	_scrim.color = Color(0.031, 0.031, 0.027, 0.52)
	_scrim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_scrim.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(_scrim)

	# the sheet lies on the desk: a soft shadow, the stock itself, then the printed matter
	_shadow = Panel.new()
	_shadow.name = "Shadow"
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0)
	sb.shadow_color = Color(0, 0, 0, 0.5)
	sb.shadow_size = 26
	sb.shadow_offset = Vector2(0, 10)
	sb.corner_detail = 1
	_shadow.add_theme_stylebox_override("panel", sb)
	_shadow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_shadow)

	_frame = Control.new()
	_frame.name = "Sheet"
	_frame.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(_frame)

	_stock = PaperUI.Stock.new()
	_stock.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_frame.add_child(_stock)

	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 30)
	margin.add_theme_constant_override("margin_right", 30)
	margin.add_theme_constant_override("margin_top", 20)
	margin.add_theme_constant_override("margin_bottom", 16)
	_frame.add_child(margin)

	_stack = VBoxContainer.new()
	_stack.add_theme_constant_override("separation", 0)
	margin.add_child(_stack)

	_header = HBoxContainer.new()
	_header.add_theme_constant_override("separation", 24)
	_stack.add_child(_header)
	_stack.add_child(PaperUI.spacer(7))
	_head_rule = PaperUI.Rule.new("solid", Paper.ink(0.75))
	_stack.add_child(_head_rule)
	_stack.add_child(PaperUI.spacer(10))

	_body = MarginContainer.new()
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_stack.add_child(_body)

	_stack.add_child(PaperUI.spacer(6))
	_notice = PaperUI.label("", Paper.S_SMALL, Paper.AMBER)
	_notice.custom_minimum_size = Vector2(0, 20)
	_notice.clip_text = true
	_stack.add_child(_notice)
	_stack.add_child(PaperUI.spacer(4))
	_foot_rule = PaperUI.Rule.new("solid", Paper.ink(0.22))
	_stack.add_child(_foot_rule)
	_stack.add_child(PaperUI.spacer(7))

	_footer = HBoxContainer.new()
	_footer.add_theme_constant_override("separation", 24)
	_stack.add_child(_footer)

func _clear(node: Node) -> void:
	for c in node.get_children():
		node.remove_child(c)
		c.queue_free()

func _chrome_text() -> void:
	_clear(_header); _clear(_footer)
	if panel == null: return
	var chrome := panel.wants_chrome()
	_header.visible = chrome
	_head_rule.visible = chrome
	_notice.visible = chrome
	_foot_rule.visible = chrome
	_footer.visible = chrome
	if not chrome: return
	var st: Dictionary = Game.state
	_header.add_child(PaperUI.caps(panel.title_text(), Paper.S_TINY, Paper.INK, true))
	_header.add_child(PaperUI.stretch())
	_header.add_child(PaperUI.caps("Explorer %d" % int(st.get("explorer", 61)), Paper.S_MICRO, Paper.ink(0.62)))
	_header.add_child(PaperUI.caps("Funds %s" % Paper.money(int(st.get("money", 0))), Paper.S_MICRO, Paper.ink(0.62)))
	if Game.inventory != null:
		var w: float = Game.inventory.weight()
		var c: float = Game.inventory.capacity()
		var over := w > c
		var cap_text := "%s" % (String.num(c, 0) if not is_inf(c) else "no limit")
		_header.add_child(PaperUI.caps("Load %s / %s kg" % [String.num(w, 1), cap_text], Paper.S_MICRO, Paper.RED if over else Paper.ink(0.62)))
	_header.add_child(PaperUI.caps("Day %d · %s · Tide in %s" % [Clock.day, Clock.clock_text(), Clock.tide_in_text()], Paper.S_MICRO,
		Paper.RED if Clock.tide_in() < 3600.0 else Paper.ink(0.62)))

	_footer.add_child(PaperUI.caps(panel.key_hint(), Paper.S_MICRO, Paper.ink(0.55)))
	_footer.add_child(PaperUI.stretch())
	_footer.add_child(PaperUI.caps("Clearance %d · %s" % [int(st.get("securityLevel", 1)), _rank_title()], Paper.S_MICRO, Paper.ink(0.55)))
	_footer.add_child(PaperUI.caps("Form %s" % panel.form_code(), Paper.S_MICRO, Paper.ink(0.55)))
	_notice.text = _notice_text
	_notice.add_theme_color_override("font_color", Paper.RED if _notice_red else Paper.AMBER)

func _rank_title() -> String:
	var d: Dictionary = Data.ranks.get(str(int(Game.state.get("securityLevel", 1))), {})
	return str(d.get("title", "Explorer"))

func _layout() -> void:
	if panel == null or _root == null: return
	var vp := Vector2(_root.size)
	if vp.x <= 0.0: vp = Vector2(get_viewport().get_visible_rect().size)
	var want := panel.sheet_size(vp)
	want.x = minf(want.x, vp.x - 24.0)
	want.y = minf(want.y, vp.y - 24.0)
	_frame.size = want
	_frame.position = ((vp - want) * 0.5).floor()
	_frame.pivot_offset = want * 0.5
	_shadow.size = want
	_shadow.position = _frame.position

# ------------------------------------------------------------------------------------------------------------------
# open / close
# ------------------------------------------------------------------------------------------------------------------
func _on_open_panel(name: String, d: Dictionary) -> void: open(name, d)
func _on_close_panel() -> void: close()
func _on_player_died(info: Dictionary) -> void:
	locked = false
	open("death", info if info != null else {})
func _on_game_started(_new_game: bool) -> void:
	if is_open:
		locked = false
		close()

func open(name: String, d: Dictionary = {}) -> bool:
	if locked: return false
	if not PANEL_SCRIPTS.has(name):
		push_warning("[panels] no such form: " + name)
		return false
	if is_open and current == name and name != "death":
		close(); return false
	var script_path: String = PANEL_SCRIPTS[name]
	if not ResourceLoader.exists(script_path):
		push_warning("[panels] missing script " + script_path)
		return false
	if panel != null:
		panel.on_close()
		_body.remove_child(panel)
		panel.queue_free()
		panel = null
	var scr: Variant = load(script_path)
	var p: Variant = scr.new()
	if not (p is RadiusPanel):
		push_warning("[panels] %s is not a RadiusPanel" % name)
		return false
	panel = p
	panel.setup(self, d)
	_notice_text = ""; _notice_red = false
	current = name
	panel.on_open()
	_body.add_child(panel)
	panel.build()
	_chrome_text()
	_layout()
	if not is_open:
		is_open = true
		_mode_before = Game.mode
		if Game.mode != "paused": Game.set_mode("paused")
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		_root.visible = true
		_animate_in()
		play("ui_open", 0.5)
	else:
		play("paper_flip", 0.4)
	_focus_first()
	opened.emit(name)
	return true

func _animate_in() -> void:
	_scrim.modulate = Color(1, 1, 1, 0)
	_frame.modulate = Color(1, 1, 1, 0)
	_shadow.modulate = Color(1, 1, 1, 0)
	var t := create_tween()
	t.set_parallel(true)
	t.tween_property(_scrim, "modulate", Color(1, 1, 1, 1), 0.14)
	t.tween_property(_frame, "modulate", Color(1, 1, 1, 1), 0.16)
	t.tween_property(_shadow, "modulate", Color(1, 1, 1, 1), 0.22)

func close() -> void:
	if not is_open or locked: return
	if panel != null:
		panel.on_close()
		_body.remove_child(panel)
		panel.queue_free()
		panel = null
	var was := current
	is_open = false
	current = ""
	_root.visible = false
	play("ui_close", 0.45)
	# the incident report hands over to Game.start(); every other form gives the world back as it found it
	if was != "death" and Game.mode == "paused":
		Game.set_mode(_mode_before if _mode_before != "paused" else "playing")
	closed.emit()

func set_locked(v: bool) -> void: locked = v

# ------------------------------------------------------------------------------------------------------------------
# refresh keeping the reader's place
# ------------------------------------------------------------------------------------------------------------------
func refresh() -> void:
	if panel == null: return
	var focus_key := ""
	var focus_index := -1
	var f := _root.get_viewport().gui_get_focus_owner()
	var list := _focusables(panel)
	if f != null:
		focus_index = list.find(f)
		if f.has_meta("fkey"): focus_key = str(f.get_meta("fkey"))
	var scrolls := _scroll_state(panel)
	for c in panel.get_children():
		panel.remove_child(c)
		c.queue_free()
	panel.build()
	_chrome_text()
	_layout()
	await get_tree().process_frame
	if panel == null: return
	_restore_scroll(panel, scrolls)
	var after := _focusables(panel)
	if after.is_empty(): return
	if focus_key != "":
		for c in after:
			if c.has_meta("fkey") and str(c.get_meta("fkey")) == focus_key:
				c.grab_focus(); return
	if focus_index >= 0:
		after[clampi(focus_index, 0, after.size() - 1)].grab_focus()

func _focusables(root: Node) -> Array:
	var out: Array = []
	_walk_focus(root, out)
	return out
func _walk_focus(n: Node, out: Array) -> void:
	for c in n.get_children():
		if c is Control and c.focus_mode == Control.FOCUS_ALL and c.is_visible_in_tree() and not (c is Button and c.disabled):
			out.append(c)
		_walk_focus(c, out)

func _scroll_state(root: Node) -> Array:
	var out: Array = []
	for s in _all_scrolls(root): out.append(s.scroll_vertical)
	return out
func _restore_scroll(root: Node, vals: Array) -> void:
	var list := _all_scrolls(root)
	for i in mini(list.size(), vals.size()):
		list[i].scroll_vertical = int(vals[i])
func _all_scrolls(n: Node) -> Array:
	var out: Array = []
	_walk_scrolls(n, out)
	return out
func _walk_scrolls(n: Node, out: Array) -> void:
	for c in n.get_children():
		if c is ScrollContainer: out.append(c)
		_walk_scrolls(c, out)

func _focus_first() -> void:
	await get_tree().process_frame
	if panel == null: return
	var list := _focusables(panel)
	for c in list:
		if c is Button and c.theme_type_variation == "PaperTab": continue
		c.grab_focus(); return
	if not list.is_empty(): list[0].grab_focus()

# ------------------------------------------------------------------------------------------------------------------
# notices and sound
# ------------------------------------------------------------------------------------------------------------------
func set_notice(text: String, red := false) -> void:
	_notice_text = text
	_notice_red = red
	if _notice != null:
		_notice.text = text
		_notice.add_theme_color_override("font_color", Paper.RED if red else Paper.AMBER)

func play(name: String, gain := 0.5) -> void:
	if Audio == null: return
	if Audio.has(name): Audio.play(name, null, gain)

# ------------------------------------------------------------------------------------------------------------------
# input
# ------------------------------------------------------------------------------------------------------------------
func _input(event: InputEvent) -> void:
	if not is_open or panel == null: return
	if not (event is InputEventKey): return
	var k := event as InputEventKey
	if not k.pressed or k.echo: return
	if panel.handle_key(k):
		get_viewport().set_input_as_handled(); return
	if k.keycode == KEY_ESCAPE:
		if not locked: close()
		get_viewport().set_input_as_handled(); return
	var act := panel.close_action()
	if act != "" and InputMap.has_action(act) and event.is_action_pressed(act):
		if not locked: close()
		get_viewport().set_input_as_handled(); return
	if k.keycode >= KEY_1 and k.keycode <= KEY_9:
		if _pick_tab(k.keycode - KEY_1):
			get_viewport().set_input_as_handled(); return

func _pick_tab(index: int) -> bool:
	var strip := _find_tabstrip(panel)
	if strip == null: return false
	var buttons: Array = []
	for c in strip.get_children():
		if c is HBoxContainer:
			for b in c.get_children():
				if b is Button and b.has_meta("tab"): buttons.append(b)
	if index < 0 or index >= buttons.size(): return false
	buttons[index].emit_signal("pressed")
	return true

func _find_tabstrip(n: Node) -> Node:
	for c in n.get_children():
		if c.has_meta("tabstrip"): return c
		var r := _find_tabstrip(c)
		if r != null: return r
	return null

# ------------------------------------------------------------------------------------------------------------------
# the Explorer's own annotations: which POIs have been walked to (the map reads this)
# ------------------------------------------------------------------------------------------------------------------
func _process(dt: float) -> void:
	if is_open and panel != null: panel.on_tick(dt)
	_discover_t -= dt
	if _discover_t > 0.0: return
	_discover_t = 1.0
	if Game.mode != "playing" or Game.player == null or not is_instance_valid(Game.player): return
	var pois: Variant = Data.map.get("POIS", [])
	if not (pois is Array) or pois.is_empty(): return
	var flags: Dictionary = Game.state.get("flags", {})
	if not (flags.get("pois") is Dictionary): flags["pois"] = {}
	var seen: Dictionary = flags["pois"]
	var p: Vector3 = Game.player.global_position
	for poi in pois:
		var id := str(poi.get("id", ""))
		if id == "" or seen.has(id): continue
		var d := Vector2(float(poi.get("x", 0)) - p.x, float(poi.get("z", 0)) - p.z).length()
		if d < float(poi.get("r", 20)) + 45.0:
			seen[id] = true
