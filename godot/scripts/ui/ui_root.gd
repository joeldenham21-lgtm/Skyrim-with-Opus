extends Control
class_name UiRoot
## The single UI entry point. One node under the "UI" CanvasLayer of scenes/main.tscn owns the whole front
## end: the in-world HUD, the panel host (base stations, inventory, loot, map) and the menus (title, pause,
## settings, death). Only the HUD is guaranteed to exist — the other two are instantiated when their scenes
## land, so the panel and menu agents can arrive later without a change here.
##
## INSTALLATION (one line, in scripts/main.gd _ready, after Game.player/Game.world are set):
##     UiRoot.install(self)
## or attach this script to a Control child of the UI CanvasLayer in scenes/main.tscn. install() is
## idempotent: it does nothing when a UiRoot is already in the tree.
##
## Layers, back to front:  Hud → Panels → Menus → Touch
##
## Routing: Events.open_panel(name, data) / Events.close_panel() reach the panel host if it has open()/close();
## either way the HUD is told to stand down while a form is on the desk, and the mouse is released.
##
## API:  hud() -> Hud, panels() -> Node, menus() -> Node, ui_busy() -> bool

const HUD_SCENE := "res://scenes/ui/hud.tscn"
const PANELS_SCENE := "res://scenes/ui/panels.tscn"
const PANEL_HOST_SCRIPT := "res://scripts/ui/panel_host.gd"
const MENUS_SCENE := "res://scenes/ui/menus.tscn"
const MENUS_SCRIPT := "res://scripts/ui/menus.gd"
const TOUCH_SCENE := "res://scenes/ui/touch.tscn"

var _hud: Control = null
var _panels: Node = null
var _menus: Node = null
var _touch: Node = null
var _open_panel := ""

static func install(root: Node) -> Node:
	if root == null:
		return null
	var tree := root.get_tree()
	if tree != null:
		var existing := tree.get_first_node_in_group("ui_root")
		if existing != null:
			return existing
	var layer: Node = root.get_node_or_null("UI")
	if layer == null:
		var cl := CanvasLayer.new()
		cl.name = "UI"
		cl.layer = 2
		root.add_child(cl)
		layer = cl
	var node: Node = (load("res://scripts/ui/ui_root.gd") as GDScript).new()
	node.name = "UiRoot"
	layer.add_child(node)
	return node

func _ready() -> void:
	add_to_group("ui_root")
	name = "UiRoot"
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	process_mode = Node.PROCESS_MODE_ALWAYS
	set_anchors_preset(Control.PRESET_FULL_RECT)
	if theme == null:
		theme = UIStyle.theme()
	_hud = _spawn(HUD_SCENE, "Hud")
	_panels = _spawn_host(PANEL_HOST_SCRIPT, PANELS_SCENE, "Panels")
	_menus = _spawn_host(MENUS_SCRIPT, MENUS_SCENE, "Menus")
	if _wants_touch():
		_touch = _spawn(TOUCH_SCENE, "Touch")
	if not Events.open_panel.is_connected(_on_open_panel):
		Events.open_panel.connect(_on_open_panel)
	if not Events.close_panel.is_connected(_on_close_panel):
		Events.close_panel.connect(_on_close_panel)
	if not Events.mode_changed.is_connected(_on_mode):
		Events.mode_changed.connect(_on_mode)
	_refresh()

func _spawn(path: String, node_name: String) -> Node:
	if not ResourceLoader.exists(path):
		return null
	var packed: Variant = load(path)
	if not (packed is PackedScene):
		return null
	var n: Node = (packed as PackedScene).instantiate()
	n.name = node_name
	add_child(n)
	if n is Control:
		(n as Control).set_anchors_preset(Control.PRESET_FULL_RECT)
	return n

## The panel host and the menus are owned by other agents and may arrive either as a scene under this node
## or as a self-installing script with a static ensure(tree). Take whichever exists; tolerate neither.
func _spawn_host(script_path: String, scene_path: String, node_name: String) -> Node:
	if ResourceLoader.exists(script_path):
		var scr: Variant = load(script_path)
		if scr is GDScript and (scr as GDScript).has_method("ensure"):
			var n: Variant = (scr as GDScript).call("ensure", get_tree())
			if n is Node:
				return n
	return _spawn(scene_path, node_name)

func _wants_touch() -> bool:
	var mode := str(Game.state.get("settings", {}).get("touch", "auto"))
	if mode == "on":
		return true
	if mode == "off":
		return false
	return DisplayServer.is_touchscreen_available()

# ── accessors ──────────────────────────────────────────────────────────────────────────────────────────
func hud() -> Node:
	return _hud

func panels() -> Node:
	return _panels

func menus() -> Node:
	return _menus

func ui_busy() -> bool:
	if _open_panel != "":
		return true
	if _menus != null and is_instance_valid(_menus):
		if _menus.has_method("is_menu_open"):
			return bool(_menus.is_menu_open())
		if "is_open" in _menus:
			return bool(_menus.get("is_open"))
	if _panels != null and is_instance_valid(_panels) and "is_open" in _panels:
		if bool(_panels.get("is_open")):
			return true
	return Game.mode != "playing"

# ── routing ────────────────────────────────────────────────────────────────────────────────────────────
func _on_open_panel(panel_name: String, data: Dictionary) -> void:
	_open_panel = panel_name
	# a host in the "panel_host" group listens to Events itself; only drive a passive host
	if _panels != null and is_instance_valid(_panels) and _panels.has_method("open") and not _panels.is_in_group("panel_host"):
		_panels.open(panel_name, data)
	_refresh()

func _on_close_panel() -> void:
	_open_panel = ""
	if _panels != null and is_instance_valid(_panels) and _panels.has_method("close") and not _panels.is_in_group("panel_host"):
		_panels.close()
	_refresh()

func _on_mode(_mode: String) -> void:
	_refresh()

func _refresh() -> void:
	var busy := ui_busy()
	if _hud != null and is_instance_valid(_hud) and _hud.has_method("set_game_visible"):
		_hud.set_game_visible(not busy)
	if _touch != null and is_instance_valid(_touch) and _touch is CanvasItem:
		(_touch as CanvasItem).visible = not busy and Game.mode == "playing"
