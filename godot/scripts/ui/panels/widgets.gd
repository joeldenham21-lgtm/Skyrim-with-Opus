class_name PaperUI
extends RefCounted
## The parts a Committee form is made of: the sheet itself, hairlines, section heads, rows, condition bars, tags,
## rubber stamps and the drawn glyphs the map legend uses. Everything is a plain Control so the panels stay
## keyboard-navigable through Godot's own focus walk.

const H_ROW := 26

# ------------------------------------------------------------------------------------------------------------------
# drawn parts
# ------------------------------------------------------------------------------------------------------------------

## A hairline. style: solid | dotted | dashed. Horizontal unless vertical is set.
class Rule extends Control:
	var col: Color = Paper.ink(0.26)
	var style: String = "solid"
	var vertical := false
	var thickness := 1.0
	func _init(p_style: String = "solid", p_col: Color = Paper.ink(0.26), p_vertical := false) -> void:
		style = p_style; col = p_col; vertical = p_vertical
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		if vertical:
			custom_minimum_size = Vector2(1, 0)
			size_flags_vertical = Control.SIZE_EXPAND_FILL
		else:
			custom_minimum_size = Vector2(0, 1)
			size_flags_horizontal = Control.SIZE_EXPAND_FILL
	func _draw() -> void:
		var len_px: float = size.y if vertical else size.x
		if len_px <= 0.0: return
		if style == "solid":
			if vertical: draw_rect(Rect2(0, 0, thickness, size.y), col)
			else: draw_rect(Rect2(0, 0, size.x, thickness), col)
			return
		var on := 1.0 if style == "dotted" else 4.0
		var off := 3.0 if style == "dotted" else 3.0
		var x := 0.0
		while x < len_px:
			var w: float = minf(on, len_px - x)
			if vertical: draw_rect(Rect2(0, x, thickness, w), col)
			else: draw_rect(Rect2(x, 0, w, thickness), col)
			x += on + off

## A condition / load bar. `value` 0..1, `over` draws the part past 1 in red hatching.
class Bar extends Control:
	var value := 0.0
	var col: Color = Paper.AMBER
	var track: Color = Paper.ink(0.13)
	var over := false
	func _init(p_value: float, p_col: Color = Paper.AMBER, p_h: float = 3.0, p_over := false) -> void:
		value = clampf(p_value, 0.0, 1.0); col = p_col; over = p_over
		custom_minimum_size = Vector2(0, p_h)
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _draw() -> void:
		draw_rect(Rect2(0, 0, size.x, size.y), track)
		draw_rect(Rect2(0, 0, size.x * value, size.y), col)
		if over:
			var x := 0.0
			while x < size.x:
				draw_rect(Rect2(x, 0, 1.0, size.y), Paper.red(0.55))
				x += 4.0

## A piece of stock, used when the shared SheetPanel widget is not there yet: the paper ground, the laid fibre,
## the foxing and the torn top edge.
class Stock extends Control:
	var fibre: Texture2D = null
	var stain: Texture2D = null
	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		fibre = Paper.fibre_texture()
		stain = Paper.stain_texture()
	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		draw_rect(r, Paper.PAPER)
		if stain != null: draw_texture_rect(stain, r, false, Color(1, 1, 1, 0.9))
		if fibre != null: draw_texture_rect(fibre, r, true, Color(1, 1, 1, 0.55))
		draw_rect(r, Paper.ink(0.5), false, 1.0)
		var x := 0.0
		while x < size.x:
			draw_rect(Rect2(x, 0, 7, 2), Paper.ink(0.18))
			x += 11.0

## One drawn map-legend symbol, matched to the glyphs on the sheet itself.
class Glyph extends Control:
	var kind := "container"
	var col: Color = Paper.ink(0.85)
	func _init(p_kind: String, p_col: Color = Paper.ink(0.85)) -> void:
		kind = p_kind; col = p_col
		custom_minimum_size = Vector2(16, 14)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _draw() -> void:
		var c := size * 0.5
		match kind:
			"road":
				var x := 1.0
				while x < size.x - 1.0:
					draw_rect(Rect2(x, c.y, 4, 1.2), col); x += 7.0
			"rail":
				draw_rect(Rect2(1, c.y, size.x - 2, 1.2), col)
				for i in 4: draw_rect(Rect2(2.0 + i * 3.5, c.y - 3, 1.0, 7), col)
			"marsh":
				for i in 9:
					var a := float(i) * 2.4
					draw_rect(Rect2(c.x + cos(a) * (2 + i * 0.5), c.y + sin(a) * (1.5 + i * 0.3), 1.2, 1.2), col)
			"anomaly":
				draw_arc(c, 5.0, 0, TAU, 20, col, 1.0)
				draw_circle(c, 1.4, col)
			"container": draw_rect(Rect2(c.x - 3, c.y - 3, 6, 6), col, false, 1.0)
			"emptied": draw_rect(Rect2(c.x - 3, c.y - 3, 6, 6), col)
			"corpse":
				draw_rect(Rect2(c.x - 4, c.y, 8, 1.0), col)
				draw_rect(Rect2(c.x, c.y - 4, 1.0, 7), col)
			"entity":
				draw_polyline([Vector2(c.x - 5, c.y + 3), Vector2(c.x, c.y - 4), Vector2(c.x + 5, c.y + 3)], col, 1.4)
			"explorer":
				draw_arc(c, 4.0, 0, TAU, 18, col, 1.4)
				draw_rect(Rect2(c.x - 0.5, c.y - 10, 1.0, 6), col)
			"objective":
				draw_line(Vector2(c.x - 5, c.y - 5), Vector2(c.x + 5, c.y + 5), col, 1.5)
				draw_line(Vector2(c.x + 5, c.y - 5), Vector2(c.x - 5, c.y + 5), col, 1.5)
			"poi": draw_rect(Rect2(c.x - 4, c.y - 4, 8, 8), col, false, 1.0)

# ------------------------------------------------------------------------------------------------------------------
# the shared widgets when the HUD agent has landed them, our own stock otherwise
# ------------------------------------------------------------------------------------------------------------------
const SHEET_WIDGET := "res://scripts/ui/widgets/sheet.gd"
const STAMP_WIDGET := "res://scripts/ui/widgets/stamp.gd"

## The sheet a form is printed on. Returns a PanelContainer-like Control that takes one child.
static func sheet(seed_v := 0.0) -> Control:
	if ResourceLoader.exists(SHEET_WIDGET):
		var scr: Variant = load(SHEET_WIDGET)
		if scr != null:
			var n: Variant = scr.new()
			if n is PanelContainer:
				n.set("seed_v", seed_v)
				n.set("grain", 0.5)
				return n
	var pc := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Paper.PAPER; sb.border_color = Paper.ink(0.5); sb.set_border_width_all(1); sb.corner_detail = 1
	sb.content_margin_left = 22; sb.content_margin_right = 22; sb.content_margin_top = 16; sb.content_margin_bottom = 16
	pc.add_theme_stylebox_override("panel", sb)
	var stock := Stock.new()
	stock.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	pc.add_child(stock)
	return pc

## A rubber stamp.
static func stamp(text: String, col: Color = Paper.AMBER, angle_deg := -6.0, font_size := 16) -> Control:
	if ResourceLoader.exists(STAMP_WIDGET):
		var scr: Variant = load(STAMP_WIDGET)
		if scr != null:
			var n: Variant = scr.new()
			if n is Control:
				n.set("text", text.to_upper()); n.set("accent", col); n.set("angle_deg", angle_deg); n.set("font_size", font_size)
				return n
	var l := label(text.to_upper(), font_size, col, "display_wide")
	l.rotation = deg_to_rad(angle_deg)
	return l

# ------------------------------------------------------------------------------------------------------------------
# text
# ------------------------------------------------------------------------------------------------------------------
static func label(text: String, size_px: int = Paper.S_SMALL, col: Color = Paper.INK, font_kind: String = "mono") -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", Paper.font(font_kind))
	l.add_theme_font_size_override("font_size", size_px)
	l.add_theme_color_override("font_color", col)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

## Tracked upper case, the register's small print.
static func caps(text: String, size_px: int = Paper.S_MICRO, col: Color = Paper.ink(0.62), medium := false) -> Label:
	var l := label(text.to_upper(), size_px, col, "caps_med" if medium else "caps")
	return l

static func display(text: String, size_px: int = Paper.S_H1, col: Color = Paper.INK) -> Label:
	return label(text.to_upper(), size_px, col, "display_wide")

## Body copy that wraps: notes, contract text, item flavour.
static func para(text: String, size_px: int = Paper.S_SMALL, col: Color = Paper.ink(0.64)) -> Label:
	var l := label(text, size_px, col)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l

static func empty(text: String) -> Control:
	var l := label(text, Paper.S_SMALL, Paper.ink(0.40))
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var m := MarginContainer.new()
	m.add_theme_constant_override("margin_top", 6); m.add_theme_constant_override("margin_bottom", 6)
	m.add_theme_constant_override("margin_left", 2)
	m.add_child(l)
	return m

static func spacer(h: int) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

static func hspacer(w: int) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, 0)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

static func stretch() -> Control:
	var c := Control.new()
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

# ------------------------------------------------------------------------------------------------------------------
# structure
# ------------------------------------------------------------------------------------------------------------------
## Section head: amber tracked caps, a count, then a rule to the right margin.
static func section(title: String, count: Variant = null) -> Control:
	var box := VBoxContainer.new()
	box.add_child(spacer(12))
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	h.add_child(caps(title, Paper.S_MICRO, Paper.AMBER, true))
	if count != null and str(count) != "":
		h.add_child(caps(str(count), Paper.S_MICRO, Paper.ink(0.55)))
	var r := Rule.new("solid", Paper.ink(0.24))
	r.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(r)
	box.add_child(h)
	box.add_child(spacer(4))
	return box

## A number with its unit set small and dim, right aligned: "17" + "rounds".
static func number(value: String, unit: String = "", col: Color = Paper.INK) -> Control:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 4)
	h.alignment = BoxContainer.ALIGNMENT_END
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(label(value, Paper.S_SMALL, col, "mono_med"))
	if unit != "":
		h.add_child(caps(unit, Paper.S_MICRO, Paper.ink(0.50)))
	return h

## The little upper-case marker after a name ("ready", "worn", "in pack").
static func tag(text: String, col: Color = Paper.ink(0.55)) -> Control:
	var l := caps(text, Paper.S_MICRO, col)
	var m := MarginContainer.new()
	m.add_theme_constant_override("margin_left", 8)
	m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	m.add_child(l)
	return m

## Name over a dim sub-line. Returns the VBox so callers can append tags to the name row.
static func name_block(name: String, sub: String = "", tags: Array = [], name_col: Color = Paper.INK) -> Control:
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_theme_constant_override("separation", 1)
	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var nl := label(name, Paper.S_SMALL, name_col, "mono_med")
	nl.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	top.add_child(nl)
	for t in tags:
		if t is String: top.add_child(tag(str(t)))
		elif t is Array and t.size() == 2: top.add_child(tag(str(t[0]), t[1]))
	top.add_child(stretch())
	v.add_child(top)
	if sub != "":
		var sl := label(sub, Paper.S_TINY, Paper.ink(0.58))
		sl.clip_text = true
		v.add_child(sl)
	return v

## One ruled line of the form: a left block, a right number, an action strip. Adds its own dotted underline.
static func row(left: Control, right: Variant = null, acts: Array = [], dim := false) -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 0)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 12)
	h.custom_minimum_size = Vector2(0, H_ROW)
	h.alignment = BoxContainer.ALIGNMENT_BEGIN
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if dim: left.modulate = Color(1, 1, 1, 0.55)
	h.add_child(left)
	if right != null:
		var rc: Control = right if right is Control else number(str(right))
		rc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		rc.size_flags_horizontal = Control.SIZE_SHRINK_END
		if dim: rc.modulate = Color(1, 1, 1, 0.55)
		h.add_child(rc)
	if not acts.is_empty():
		var a := HBoxContainer.new()
		a.add_theme_constant_override("separation", 6)
		a.alignment = BoxContainer.ALIGNMENT_END
		a.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		for b in acts:
			if b is Control: a.add_child(b)
		h.add_child(a)
	v.add_child(h)
	v.add_child(Rule.new("dotted", Paper.ink(0.22)))
	return v

## A key/value line for the item card.
static func kv(k: String, v: String, col: Color = Paper.INK) -> Control:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	h.custom_minimum_size = Vector2(0, 20)
	var kl := label(k, Paper.S_TINY, Paper.ink(0.60))
	kl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	kl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(kl)
	var vl := label(v, Paper.S_SMALL, col, "mono_med")
	vl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	vl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	h.add_child(vl)
	var v2 := VBoxContainer.new()
	v2.add_theme_constant_override("separation", 0)
	v2.add_child(h)
	v2.add_child(Rule.new("dotted", Paper.ink(0.18)))
	return v2

# ------------------------------------------------------------------------------------------------------------------
# controls
# ------------------------------------------------------------------------------------------------------------------
## A small paper action button. opts: disabled, on (amber, pressed look), deny (dashed / faint), tooltip, wide.
static func act(text: String, cb: Callable, opts: Dictionary = {}) -> Button:
	var b := Button.new()
	b.theme_type_variation = "Act"
	b.text = text.to_upper()
	b.focus_mode = Control.FOCUS_ALL
	b.disabled = bool(opts.get("disabled", false))
	if opts.has("tooltip"): b.tooltip_text = str(opts["tooltip"])
	if bool(opts.get("on", false)):
		b.add_theme_color_override("font_color", Paper.AMBER)
		b.add_theme_stylebox_override("normal", Paper._flat(Paper.amber(0.16), Paper.AMBER, 1, Vector4(9, 3, 9, 3)))
	if bool(opts.get("deny", false)):
		b.add_theme_color_override("font_color", Paper.ink(0.38))
	if cb.is_valid(): b.pressed.connect(cb)
	return b

static func big(text: String, cb: Callable, opts: Dictionary = {}) -> Button:
	var b := act(text, cb, opts)
	b.theme_type_variation = "Register"
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if bool(opts.get("primary", false)):
		b.add_theme_font_override("font", Paper.font("caps_med"))
	return b

## A focusable list line. Children go into the returned button's `box` (an HBoxContainer) via `add_entry`.
static func select_row(on_select: Callable, selected := false) -> Button:
	var b := Button.new()
	b.theme_type_variation = "PaperRow"
	b.focus_mode = Control.FOCUS_ALL
	b.toggle_mode = false
	b.custom_minimum_size = Vector2(0, H_ROW + 8)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if on_select.is_valid(): b.pressed.connect(on_select)
	if selected:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Paper.amber(0.14); sb.border_color = Paper.AMBER; sb.border_width_left = 2
		sb.content_margin_left = 6; sb.content_margin_top = 5; sb.content_margin_right = 6; sb.content_margin_bottom = 5
		b.add_theme_stylebox_override("normal", sb)
		b.add_theme_stylebox_override("hover", sb)
	return b

## Lay a row of controls inside a select_row so the button keeps the click but the parts still lay out.
static func row_body(host: Button, left: Control, right: Variant = null, acts: Array = []) -> void:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 12)
	h.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	h.offset_left = 8; h.offset_right = -8
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(left)
	if right != null:
		var rc: Control = right if right is Control else number(str(right))
		rc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		h.add_child(rc)
	if not acts.is_empty():
		var a := HBoxContainer.new()
		a.add_theme_constant_override("separation", 6)
		a.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		for b in acts:
			if b is Control: a.add_child(b)
		h.add_child(a)
	host.add_child(h)

## A tab strip. entries: [[id, label, count]]. Returns the HBox; the buttons carry meta "tab" for digit keys.
static func tabs(entries: Array, current: String, on_pick: Callable) -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 0)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 2)
	for e in entries:
		var id := str(e[0])
		var text := str(e[1])
		var b := Button.new()
		b.theme_type_variation = "Tab"
		b.text = text.to_upper()
		b.focus_mode = Control.FOCUS_ALL
		b.set_meta("tab", id)
		if e.size() > 2 and str(e[2]) != "" and str(e[2]) != "0":
			b.text += "  " + str(e[2])
		if id == current:
			b.toggle_mode = true
			b.button_pressed = true
			b.add_theme_color_override("font_color", Paper.INK)
		b.pressed.connect(on_pick.bind(id))
		h.add_child(b)
	v.add_child(h)
	v.add_child(Rule.new("solid", Paper.ink(0.24)))
	v.set_meta("tabstrip", true)
	return v

## A scrolling column that follows keyboard focus.
static func scroll() -> ScrollContainer:
	var s := ScrollContainer.new()
	s.follow_focus = true
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	s.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	return s

static func column(sep: int = 0) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return v

static func rowbox(sep: int = 10) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return h

## A scrolling column inside a fixed-width panel column, with an optional vertical rule on its right.
static func pane(width: float, sep: int = 0) -> VBoxContainer:
	var v := column(sep)
	v.custom_minimum_size = Vector2(width, 0)
	v.size_flags_horizontal = Control.SIZE_FILL
	v.size_flags_stretch_ratio = 0.0
	return v

## Note copy at the foot of a section.
static func note(text: String) -> Control:
	var m := MarginContainer.new()
	m.add_theme_constant_override("margin_top", 8)
	m.add_theme_constant_override("margin_bottom", 2)
	m.add_child(para(text, Paper.S_TINY, Paper.ink(0.58)))
	return m
