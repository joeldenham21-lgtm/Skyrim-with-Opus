extends SceneTree
## RADIUS shared UI theme. Builds scenes/ui/theme.tres from the OFL fonts in assets/fonts and the DESIGN.md
## palette. Every panel, menu and HUD readout in the game uses this theme; nothing hard-codes a font or a colour.
##
## REGENERATE:  godot --headless --path . -s scripts/ui/theme_builder.gd
## USE AT RUNTIME:  var t: Theme = UiTheme.get_theme()     (loads the .tres, rebuilds in memory if it is missing)
##
## ── FONTS ──────────────────────────────────────────────────────────────────────────────────────────────
##   default          IBM Plex Mono Regular                     body copy, data, figures
##   Mono/Medium      IBM Plex Mono Medium                      emphasis inside a line
##   Mono/SemiBold    IBM Plex Mono SemiBold                    figures that must read at a glance
##   Caps             Plex Mono Medium   + 1.5 px glyph spacing UPPERCASE labels, keys, stamps
##   CapsWide         Plex Mono SemiBold + 3.0 px               section rules, headers, plate lines
##   Display          Oswald Light       + 2.0 px               headings
##   DisplayWide      Oswald Light       + 8.0 px               title plates
##   Figure           Oswald Medium      + 1.0 px               big numerals (tide countdown, ammo, clock)
##
## ── FONT SIZES ─────────────────────────────────────────────────────────────────────────────────────────
##   micro 11 · small 12 · base 13 (theme default) · data 14 · lead 16 · head 22 · title 34 · plate 64
##   Read them back with  theme.get_font_size("micro", "Radius")  etc.
##
## ── COLOURS  (theme type "Radius": theme.get_color("<name>", "Radius")) ────────────────────────────────
##   ink #1a1917 · ink_dim · ink_faint · ink_hair          ink on paper (panels, forms)
##   paper #d9d3c4 · paper_dim · paper_faint · paper_hair  paper on dark (HUD, dark panels)
##   amber #e0a458 (accent on dark) · amber_ink #a8672a (accent on paper) · amber_wash
##   red #a23b2a (on dark) · red_ink #8b2d20 (on paper) · rust #7a4a2a
##   steel #8a9098 · olive #4b5540 · birch #c9c6bd · concrete #6e6b66 · pink #ff6fa8 · cyan #7fe8ff
##   slate #14130f (panel ground) · black #0a0a09
##
## ── STYLEBOXES  (theme type "Radius": theme.get_stylebox("<name>", "Radius")) ──────────────────────────
##   sheet      paper stock, 1 px ink hairline                 forms, catalogues, the register
##   slate      0.88 near-black slab, 1 px paper hairline      dark panels over the world
##   slab       0.55 near-black slab, no border                notice slips, HUD backings
##   well       transparent, 1 px ink hairline                 list wells, item cells on paper
##   dark_well  transparent, 1 px paper hairline               list wells on dark
##   key        1 px paper hairline box, tight margins         [E] key glyph
##   rule       a single 1 px top rule                         separators
##   selected   amber wash + 2 px amber left edge              the selected row
##   empty      nothing                                        flat controls
##
## ── TYPE VARIATIONS  (Control.theme_type_variation = "<name>") ─────────────────────────────────────────
##   Label on paper : Caps CapsDim CapsAmber Micro MicroDim Data DataDim Figure Head Title Plate Red Amber
##   Label on dark  : HudCaps HudCapsDim HudMicro HudMicroDim HudData HudDim HudFigure HudAmber HudRed
##                    (the Hud* variations carry a 4 px ink outline so text stays legible over the world)
##   Button         : Register (full-width flat row, hairline top)  Act (small bordered chip)  Tab
##   PanelContainer : Sheet Slate Slab Well DarkWell
##   Others use the plain theme: Label, Button, LineEdit, ItemList, ScrollContainer, ProgressBar, PopupMenu.
##
## Hard rules from DESIGN.md §3/§8 that this file encodes: 1 px hairlines, no rounded corners, no drop
## shadows, no gradients, one amber accent, everything low contrast so the UI never fights the image.

const OUT := "res://scenes/ui/theme.tres"
const FONT_DIR := "res://assets/fonts/"

const INK := Color("1a1917")
const PAPER := Color("d9d3c4")
const AMBER := Color("e0a458")
const AMBER_INK := Color("a8672a")
const RED := Color("a23b2a")
const RED_INK := Color("8b2d20")
const RUST := Color("7a4a2a")
const STEEL := Color("8a9098")
const OLIVE := Color("4b5540")
const BIRCH := Color("c9c6bd")
const CONCRETE := Color("6e6b66")
const PINK := Color("ff6fa8")
const CYAN := Color("7fe8ff")
const SLATE := Color("14130f")
const BLACK := Color("0a0a09")

const SIZE_MICRO := 11
const SIZE_SMALL := 12
const SIZE_BASE := 13
const SIZE_DATA := 14
const SIZE_LEAD := 16
const SIZE_HEAD := 22
const SIZE_TITLE := 34
const SIZE_PLATE := 64

func _initialize() -> void:
	var t := build()
	DirAccess.make_dir_recursive_absolute("res://scenes/ui")
	var err := ResourceSaver.save(t, OUT)
	if err != OK: print("FAIL theme save: %d" % err)
	else: print("[theme] wrote %s  (%d colours, %d styleboxes)" % [OUT, 26, 9])
	quit()

# ── font helpers ───────────────────────────────────────────────────────────────────────────────────────
static func _font(file: String) -> Font:
	var p := FONT_DIR + file
	if ResourceLoader.exists(p): return load(p)
	return ThemeDB.fallback_font

static func _var(base: Font, glyph: float, embolden: float = 0.0) -> FontVariation:
	var fv := FontVariation.new()
	fv.base_font = base
	fv.spacing_glyph = int(round(glyph))
	if embolden != 0.0: fv.variation_embolden = embolden
	return fv

# ── stylebox helpers ───────────────────────────────────────────────────────────────────────────────────
static func _flat(bg: Color, border: Color = Color(0, 0, 0, 0), w: int = 0, mh: int = 0, mv: int = 0) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.draw_center = bg.a > 0.0
	s.set_border_width_all(w)
	s.border_color = border
	s.set_corner_radius_all(0)
	s.anti_aliasing = false
	s.shadow_size = 0
	s.content_margin_left = mh; s.content_margin_right = mh
	s.content_margin_top = mv; s.content_margin_bottom = mv
	return s

static func _edge(bg: Color, border: Color, left: int, top: int, right: int, bottom: int, mh: int = 0, mv: int = 0) -> StyleBoxFlat:
	var s := _flat(bg, border, 0, mh, mv)
	s.border_width_left = left; s.border_width_top = top
	s.border_width_right = right; s.border_width_bottom = bottom
	s.border_color = border
	return s

# ── the theme ──────────────────────────────────────────────────────────────────────────────────────────
static func build() -> Theme:
	var t := Theme.new()

	var mono := _font("IBMPlexMono-Regular.woff2")
	var mono_med := _font("IBMPlexMono-Medium.woff2")
	var mono_semi := _font("IBMPlexMono-SemiBold.woff2")
	var osw_light := _font("Oswald-Light.woff2")
	var osw_med := _font("Oswald-Medium.woff2")

	var caps := _var(mono_med, 1.5)
	var caps_wide := _var(mono_semi, 3.0)
	var display := _var(osw_light, 2.0)
	var display_wide := _var(osw_light, 8.0)
	var figure := _var(osw_med, 1.0)

	t.default_font = mono
	t.default_font_size = SIZE_BASE

	# named fonts and sizes, published under the "Radius" type for every other UI module
	t.set_font("mono", "Radius", mono)
	t.set_font("mono_medium", "Radius", mono_med)
	t.set_font("mono_semibold", "Radius", mono_semi)
	t.set_font("caps", "Radius", caps)
	t.set_font("caps_wide", "Radius", caps_wide)
	t.set_font("display", "Radius", display)
	t.set_font("display_wide", "Radius", display_wide)
	t.set_font("figure", "Radius", figure)
	for pair in [["micro", SIZE_MICRO], ["small", SIZE_SMALL], ["base", SIZE_BASE], ["data", SIZE_DATA],
			["lead", SIZE_LEAD], ["head", SIZE_HEAD], ["title", SIZE_TITLE], ["plate", SIZE_PLATE]]:
		t.set_font_size(str(pair[0]), "Radius", int(pair[1]))

	var ink_dim := Color(INK.r, INK.g, INK.b, 0.64)
	var ink_faint := Color(INK.r, INK.g, INK.b, 0.40)
	var ink_hair := Color(INK.r, INK.g, INK.b, 0.26)
	var paper_dim := Color(PAPER.r, PAPER.g, PAPER.b, 0.72)
	var paper_faint := Color(PAPER.r, PAPER.g, PAPER.b, 0.42)
	var paper_hair := Color(PAPER.r, PAPER.g, PAPER.b, 0.22)
	var amber_wash := Color(AMBER_INK.r, AMBER_INK.g, AMBER_INK.b, 0.09)

	for pair in [["ink", INK], ["ink_dim", ink_dim], ["ink_faint", ink_faint], ["ink_hair", ink_hair],
			["paper", PAPER], ["paper_dim", paper_dim], ["paper_faint", paper_faint], ["paper_hair", paper_hair],
			["amber", AMBER], ["amber_ink", AMBER_INK], ["amber_wash", amber_wash],
			["red", RED], ["red_ink", RED_INK], ["rust", RUST], ["steel", STEEL], ["olive", OLIVE],
			["birch", BIRCH], ["concrete", CONCRETE], ["pink", PINK], ["cyan", CYAN],
			["slate", SLATE], ["black", BLACK]]:
		t.set_color(str(pair[0]), "Radius", pair[1])

	# ── styleboxes ─────────────────────────────────────────────────────────────────────────────────────
	var sb_sheet := _flat(PAPER, Color(INK.r, INK.g, INK.b, 0.5), 1, 22, 16)
	var sb_slate := _flat(Color(SLATE.r, SLATE.g, SLATE.b, 0.88), paper_hair, 1, 16, 12)
	var sb_slab := _flat(Color(SLATE.r, SLATE.g, SLATE.b, 0.55), Color(0, 0, 0, 0), 0, 10, 7)
	var sb_well := _flat(Color(0, 0, 0, 0), ink_hair, 1, 8, 6)
	var sb_dark_well := _flat(Color(0, 0, 0, 0), paper_hair, 1, 8, 6)
	var sb_key := _flat(Color(0, 0, 0, 0.28), paper_hair, 1, 6, 1)
	var sb_rule := _edge(Color(0, 0, 0, 0), ink_hair, 0, 1, 0, 0)
	var sb_selected := _edge(amber_wash, AMBER_INK, 2, 0, 0, 0, 8, 5)
	var sb_empty := StyleBoxEmpty.new()
	for pair in [["sheet", sb_sheet], ["slate", sb_slate], ["slab", sb_slab], ["well", sb_well],
			["dark_well", sb_dark_well], ["key", sb_key], ["rule", sb_rule], ["selected", sb_selected], ["empty", sb_empty]]:
		t.set_stylebox(str(pair[0]), "Radius", pair[1])

	# ── base controls ──────────────────────────────────────────────────────────────────────────────────
	t.set_color("font_color", "Label", INK)
	t.set_color("font_outline_color", "Label", BLACK)
	t.set_constant("outline_size", "Label", 0)
	t.set_constant("line_spacing", "Label", 3)

	t.set_type_variation("Sheet", "PanelContainer"); t.set_stylebox("panel", "Sheet", sb_sheet)
	t.set_type_variation("Slate", "PanelContainer"); t.set_stylebox("panel", "Slate", sb_slate)
	t.set_type_variation("Slab", "PanelContainer"); t.set_stylebox("panel", "Slab", sb_slab)
	t.set_type_variation("Well", "PanelContainer"); t.set_stylebox("panel", "Well", sb_well)
	t.set_type_variation("DarkWell", "PanelContainer"); t.set_stylebox("panel", "DarkWell", sb_dark_well)
	t.set_stylebox("panel", "PanelContainer", sb_slate)
	t.set_stylebox("panel", "Panel", sb_slate)

	# label variations on paper
	_label(t, "Caps", caps, SIZE_SMALL, INK)
	_label(t, "CapsDim", caps, SIZE_SMALL, ink_dim)
	_label(t, "CapsAmber", caps, SIZE_SMALL, AMBER_INK)
	_label(t, "Micro", caps, SIZE_MICRO, ink_dim)
	_label(t, "MicroDim", caps, SIZE_MICRO, ink_faint)
	_label(t, "Data", mono, SIZE_BASE, INK)
	_label(t, "DataDim", mono, SIZE_BASE, ink_dim)
	_label(t, "Figure", figure, SIZE_HEAD, INK)
	_label(t, "Head", display, SIZE_HEAD, INK)
	_label(t, "Title", display, SIZE_TITLE, INK)
	_label(t, "Plate", display_wide, SIZE_PLATE, INK)
	_label(t, "Red", mono_med, SIZE_BASE, RED_INK)
	_label(t, "Amber", mono_med, SIZE_BASE, AMBER_INK)

	# label variations over the world (outlined so they never disappear against grass or sky)
	_label(t, "HudCaps", caps, SIZE_SMALL, PAPER, 4)
	_label(t, "HudCapsDim", caps, SIZE_SMALL, paper_dim, 4)
	_label(t, "HudMicro", caps, SIZE_MICRO, paper_dim, 4)
	_label(t, "HudMicroDim", caps, SIZE_MICRO, paper_faint, 4)
	_label(t, "HudData", mono, SIZE_BASE, PAPER, 4)
	_label(t, "HudDim", mono, SIZE_SMALL, paper_dim, 4)
	_label(t, "HudFigure", figure, SIZE_HEAD, PAPER, 4)
	_label(t, "HudAmber", caps, SIZE_SMALL, AMBER, 4)
	_label(t, "HudRed", caps, SIZE_SMALL, RED, 4)

	# ── buttons ────────────────────────────────────────────────────────────────────────────────────────
	_button(t, "Register", caps, SIZE_SMALL, INK, AMBER_INK,
		_edge(Color(0, 0, 0, 0), ink_hair, 0, 1, 0, 0, 6, 9),
		_edge(amber_wash, ink_hair, 0, 1, 0, 0, 6, 9),
		_edge(amber_wash, AMBER_INK, 2, 1, 0, 0, 6, 9),
		ink_faint)
	_button(t, "Act", caps, SIZE_MICRO, INK, AMBER_INK,
		_flat(Color(0, 0, 0, 0), Color(INK.r, INK.g, INK.b, 0.34), 1, 9, 3),
		_flat(amber_wash, AMBER_INK, 1, 9, 3),
		_flat(amber_wash, AMBER_INK, 1, 9, 3),
		ink_faint)
	_button(t, "Tab", caps_wide, SIZE_SMALL, ink_dim, INK,
		_edge(Color(0, 0, 0, 0), AMBER_INK, 0, 0, 0, 0, 14, 7),
		_edge(amber_wash, AMBER_INK, 0, 0, 0, 0, 14, 7),
		_edge(Color(0, 0, 0, 0), AMBER_INK, 0, 0, 0, 2, 14, 7),
		ink_faint)
	# plain Button = Register so an unstyled button is never a grey rounded box
	t.set_font("font", "Button", caps); t.set_font_size("font_size", "Button", SIZE_SMALL)
	t.set_color("font_color", "Button", INK); t.set_color("font_hover_color", "Button", AMBER_INK)
	t.set_color("font_pressed_color", "Button", AMBER_INK); t.set_color("font_focus_color", "Button", AMBER_INK)
	t.set_color("font_disabled_color", "Button", ink_faint)
	t.set_stylebox("normal", "Button", _edge(Color(0, 0, 0, 0), ink_hair, 0, 1, 0, 0, 6, 9))
	t.set_stylebox("hover", "Button", _edge(amber_wash, ink_hair, 0, 1, 0, 0, 6, 9))
	t.set_stylebox("pressed", "Button", _edge(amber_wash, AMBER_INK, 2, 1, 0, 0, 6, 9))
	t.set_stylebox("focus", "Button", _edge(Color(0, 0, 0, 0), AMBER_INK, 2, 0, 0, 0, 6, 9))
	t.set_stylebox("disabled", "Button", _edge(Color(0, 0, 0, 0), ink_hair, 0, 1, 0, 0, 6, 9))

	# ── the rest: no rounded chrome anywhere ───────────────────────────────────────────────────────────
	t.set_stylebox("normal", "LineEdit", _edge(Color(0, 0, 0, 0), ink_hair, 0, 0, 0, 1, 4, 5))
	t.set_stylebox("focus", "LineEdit", _edge(amber_wash, AMBER_INK, 0, 0, 0, 1, 4, 5))
	t.set_color("font_color", "LineEdit", INK)
	t.set_color("font_placeholder_color", "LineEdit", ink_faint)
	t.set_color("caret_color", "LineEdit", AMBER_INK)
	t.set_color("selection_color", "LineEdit", amber_wash)

	t.set_stylebox("panel", "ItemList", sb_empty)
	t.set_stylebox("hovered", "ItemList", _flat(amber_wash))
	t.set_stylebox("selected", "ItemList", sb_selected)
	t.set_stylebox("selected_focus", "ItemList", sb_selected)
	t.set_color("font_color", "ItemList", INK)
	t.set_color("font_selected_color", "ItemList", INK)

	t.set_stylebox("background", "ProgressBar", _flat(ink_hair))
	t.set_stylebox("fill", "ProgressBar", _flat(AMBER_INK))
	t.set_constant("outline_size", "ProgressBar", 0)

	t.set_stylebox("scroll", "VScrollBar", _flat(Color(0, 0, 0, 0)))
	t.set_stylebox("grabber", "VScrollBar", _flat(ink_hair))
	t.set_stylebox("grabber_highlight", "VScrollBar", _flat(ink_dim))
	t.set_stylebox("grabber_pressed", "VScrollBar", _flat(AMBER_INK))
	t.set_stylebox("scroll", "HScrollBar", _flat(Color(0, 0, 0, 0)))
	t.set_stylebox("grabber", "HScrollBar", _flat(ink_hair))
	t.set_stylebox("grabber_highlight", "HScrollBar", _flat(ink_dim))
	t.set_stylebox("grabber_pressed", "HScrollBar", _flat(AMBER_INK))
	t.set_constant("scrollbar_h_separation", "ScrollContainer", 4)

	t.set_stylebox("panel", "PopupMenu", sb_sheet)
	t.set_color("font_color", "PopupMenu", INK)
	t.set_color("font_hover_color", "PopupMenu", AMBER_INK)
	t.set_stylebox("hover", "PopupMenu", _flat(amber_wash))
	t.set_stylebox("separator", "PopupMenu", _edge(Color(0, 0, 0, 0), ink_hair, 0, 1, 0, 0))

	t.set_stylebox("separator", "HSeparator", _edge(Color(0, 0, 0, 0), ink_hair, 0, 1, 0, 0))
	t.set_stylebox("separator", "VSeparator", _edge(Color(0, 0, 0, 0), ink_hair, 1, 0, 0, 0))

	t.set_stylebox("panel", "TabContainer", sb_empty)
	t.set_stylebox("tab_selected", "TabContainer", _edge(Color(0, 0, 0, 0), AMBER_INK, 0, 0, 0, 2, 14, 7))
	t.set_stylebox("tab_unselected", "TabContainer", _edge(Color(0, 0, 0, 0), ink_hair, 0, 0, 0, 1, 14, 7))
	t.set_stylebox("tab_hovered", "TabContainer", _edge(amber_wash, ink_hair, 0, 0, 0, 1, 14, 7))
	t.set_font("font", "TabContainer", caps_wide)
	t.set_font_size("font_size", "TabContainer", SIZE_SMALL)
	t.set_color("font_selected_color", "TabContainer", INK)
	t.set_color("font_unselected_color", "TabContainer", ink_dim)

	t.set_stylebox("panel", "TooltipPanel", sb_slate)
	t.set_color("font_color", "TooltipLabel", PAPER)

	return t

static func _label(t: Theme, name: String, f: Font, size: int, col: Color, outline: int = 0) -> void:
	t.set_type_variation(name, "Label")
	t.set_font("font", name, f)
	t.set_font_size("font_size", name, size)
	t.set_color("font_color", name, col)
	t.set_constant("outline_size", name, outline)
	t.set_color("font_outline_color", name, Color(0.03, 0.03, 0.025, 0.85))
	t.set_constant("line_spacing", name, 3)

static func _button(t: Theme, name: String, f: Font, size: int, col: Color, accent: Color,
		normal: StyleBox, hover: StyleBox, pressed: StyleBox, disabled_col: Color) -> void:
	t.set_type_variation(name, "Button")
	t.set_font("font", name, f)
	t.set_font_size("font_size", name, size)
	t.set_color("font_color", name, col)
	t.set_color("font_hover_color", name, accent)
	t.set_color("font_pressed_color", name, accent)
	t.set_color("font_focus_color", name, accent)
	t.set_color("font_disabled_color", name, disabled_col)
	t.set_stylebox("normal", name, normal)
	t.set_stylebox("hover", name, hover)
	t.set_stylebox("pressed", name, pressed)
	t.set_stylebox("focus", name, pressed)
	t.set_stylebox("disabled", name, normal)
	t.set_constant("outline_size", name, 0)
