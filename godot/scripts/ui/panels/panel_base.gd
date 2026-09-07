class_name RadiusPanel
extends VBoxContainer
## Base for every full-screen form. The host owns the sheet, the header, the notice line and the key legend; a panel
## fills its body and answers a few questions about itself. Subclasses override build() and the small describers.

var host: Node = null                 # PanelHost
var data: Dictionary = {}             # payload from Events.open_panel(name, data)

# ---- identity -----------------------------------------------------------------------------------------------------
func panel_id() -> String: return "panel"
func title_text() -> String: return "Form"
func form_code() -> String: return "61"
## Key legend printed in the footer.
func key_hint() -> String: return "Esc close · arrows move · Enter select · 1-9 tabs"
## An input action (project.godot) that also closes this form, e.g. "inventory" or "map".
func close_action() -> String: return ""
## false when the panel draws its own header and footer (the incident report).
func wants_chrome() -> bool: return true
## Sheet size in viewport pixels.
func sheet_size(vp: Vector2) -> Vector2:
	return Vector2(minf(vp.x - 80.0, 1560.0), minf(vp.y - 70.0, 980.0))

# ---- lifecycle ----------------------------------------------------------------------------------------------------
func setup(p_host: Node, p_data: Dictionary) -> void:
	host = p_host
	data = p_data if p_data != null else {}
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)

func build() -> void: pass
func on_open() -> void: pass
func on_close() -> void: pass
func on_tick(_dt: float) -> void: pass
## Return true when the key was consumed.
func handle_key(_event: InputEventKey) -> bool: return false

# ---- services the host provides -----------------------------------------------------------------------------------
func refresh() -> void:
	if host != null and host.has_method("refresh"): host.refresh()
func notice(text: String, red := false) -> void:
	if host != null and host.has_method("set_notice"): host.set_notice(text, red)
func snd(name: String, gain := 0.5) -> void:
	if host != null and host.has_method("play"): host.play(name, gain)
func deny(text: String) -> void:
	notice(text, true); snd("ui_deny", 0.5)
func close_self() -> void:
	if host != null and host.has_method("close"): host.close()
func open_other(name: String, d: Dictionary = {}) -> void:
	Events.open_panel.emit(name, d)

# ---- guarded access to the gameplay systems ------------------------------------------------------------------------
func inv() -> Variant: return Game.inventory
func stash() -> Variant: return Game.storage
func has_inv() -> bool: return Game.inventory != null
func state() -> Dictionary: return Game.state
func money() -> int:
	if Game.inventory != null: return Game.inventory.money()
	return int(Game.state.get("money", 0))
func economy() -> Node: return Game.economy
func rank() -> int: return int(Game.state.get("securityLevel", 1))
func rank_title(r: int = -1) -> String:
	if r < 0: r = rank()
	var d: Dictionary = Data.ranks.get(str(r), {})
	return str(d.get("title", "Explorer"))
