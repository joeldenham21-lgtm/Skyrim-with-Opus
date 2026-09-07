class_name Paper
extends RefCounted
## Committee stock: the palette, the two typefaces, the number formats and the generated paper grain that every
## panel is drawn on. DESIGN.md §8 (palette) and §10 (register). Nothing here touches gameplay state.
##
## The fonts are Latin-only subsets, so the ruble sign and the arrows are not available: money is written the way a
## UN committee writes it ("1 800 RUB"), and every glyph in the map legend is drawn, not typed.

const INK := Color(0.102, 0.098, 0.090)          # #1a1917
const PAPER := Color(0.851, 0.827, 0.769)        # #d9d3c4
const PAPER_2 := Color(0.812, 0.784, 0.714)      # #cfc8b6
const AMBER := Color(0.659, 0.404, 0.165)        # #a8672a  ink amber, not the HUD's #e0a458
const RED := Color(0.545, 0.176, 0.125)          # #8b2d20
const GREEN := Color(0.325, 0.396, 0.251)        # marsh olive, used only for "in effect" ticks

# sizes follow the shared theme's scale (micro 11 · small 12 · base 13 · data 14 · lead 16 · head 22 · title 34)
const S_BODY := 14
const S_SMALL := 13
const S_TINY := 12
const S_MICRO := 11
const S_H1 := 34
const S_H2 := 22

static var _fonts := {}
static var _theme: Theme = null
static var _fibre: ImageTexture = null
static var _stain: ImageTexture = null
static var _ext_theme_checked := false
static var _ext_theme: Theme = null

# ------------------------------------------------------------------------------------------------------------------
# colours
# ------------------------------------------------------------------------------------------------------------------
static func ink(a: float) -> Color: return Color(INK.r, INK.g, INK.b, a)
static func amber(a: float) -> Color: return Color(AMBER.r, AMBER.g, AMBER.b, a)
static func red(a: float) -> Color: return Color(RED.r, RED.g, RED.b, a)
## Condition colour for a 0..100 value: red under 30, amber under 60, ink above.
static func cond_color(pct01: float) -> Color:
	if pct01 < 0.3: return RED
	if pct01 < 0.6: return AMBER
	return INK

# ------------------------------------------------------------------------------------------------------------------
# type
# ------------------------------------------------------------------------------------------------------------------
## Named faces. The shared theme (scenes/ui/theme.tres) publishes them under the type "Radius"; when it is not
## there yet the same faces are built here so a panel is never blocked on another agent.
##   mono · mono_med · mono_semi · caps · caps_wide · display · display_wide · figure
const THEME_FONT := { "mono": "mono", "mono_med": "mono_medium", "mono_semi": "mono_semibold", "caps": "caps",
	"caps_med": "caps", "caps_wide": "caps_wide", "display": "display", "display_wide": "display_wide",
	"display_wide_med": "figure", "figure": "figure" }

static func font(kind: String = "mono") -> Font:
	if _fonts.has(kind): return _fonts[kind]
	var f: Font = null
	var shared := shared_theme()
	if shared != null:
		var n := str(THEME_FONT.get(kind, "mono"))
		if shared.has_font(n, "Radius"): f = shared.get_font(n, "Radius")
	if f == null: f = _load_font(kind)
	_fonts[kind] = f
	return f

static func _base(path: String) -> Font:
	var p := "res://assets/fonts/%s.woff2" % path
	if ResourceLoader.exists(p):
		var r: Variant = load(p)
		if r is Font: return r
	return ThemeDB.fallback_font

static func _load_font(kind: String) -> Font:
	match kind:
		"mono": return _base("IBMPlexMono-Regular")
		"mono_med": return _base("IBMPlexMono-Medium")
		"mono_semi": return _base("IBMPlexMono-SemiBold")
		"display": return _base("Oswald-Light")
		"caps", "caps_med":
			var v := FontVariation.new(); v.base_font = _base("IBMPlexMono-Medium")
			v.set_spacing(TextServer.SPACING_GLYPH, 2); return v
		"caps_wide":
			var v2 := FontVariation.new(); v2.base_font = _base("IBMPlexMono-SemiBold")
			v2.set_spacing(TextServer.SPACING_GLYPH, 3); return v2
		"display_wide":
			var v3 := FontVariation.new(); v3.base_font = _base("Oswald-Light")
			v3.set_spacing(TextServer.SPACING_GLYPH, 8); return v3
		"display_wide_med", "figure":
			var v4 := FontVariation.new(); v4.base_font = _base("Oswald-Medium")
			v4.set_spacing(TextServer.SPACING_GLYPH, 1); return v4
	return _base("IBMPlexMono-Regular")

# ------------------------------------------------------------------------------------------------------------------
# numbers and the register's phrasing
# ------------------------------------------------------------------------------------------------------------------
## 1800 -> "1 800". Groups of three, space separated (the fonts carry no thin space).
static func grouped(n: int) -> String:
	var s := str(absi(n)); var out := ""
	while s.length() > 3:
		out = " " + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out
static func money(n: int) -> String: return grouped(n) + " RUB"
static func money_num(n: int) -> String: return grouped(n)
static func kg(v: float, digits: int = 1) -> String: return String.num(v, digits) + " kg"
static func kg_num(v: float, digits: int = 1) -> String: return String.num(v, digits)
static func pct(v01: float) -> String: return "%d %%" % roundi(v01 * 100.0)
static func pct100(v: float) -> String: return "%d %%" % roundi(v)
static func clock(hour: float) -> String: return "%02d:%02d" % [int(hour), int((hour - floorf(hour)) * 60.0)]
## Seconds as the Committee writes a span: "2d 14h", "3h 05m", "12m".
static func span(seconds: float) -> String:
	var s := maxf(0.0, seconds)
	var d := int(s / 86400.0); var h := int(fmod(s, 86400.0) / 3600.0); var m := int(fmod(s, 3600.0) / 60.0)
	if d > 0: return "%dd %dh" % [d, h]
	if h > 0: return "%dh %02dm" % [h, m]
	return "%dm" % m
static func lower_first(s: String) -> String:
	return s.substr(0, 1).to_lower() + s.substr(1) if s.length() > 0 else s

# ------------------------------------------------------------------------------------------------------------------
# catalogue text (never show a raw id)
# ------------------------------------------------------------------------------------------------------------------
static func name_of(id: String) -> String:
	var d := Data.def(id)
	return str(d.get("name", id.capitalize()))
static func full_of(id: String) -> String:
	var d := Data.def(id)
	return str(d.get("full", d.get("name", id.capitalize())))
static func desc_of(id: String) -> String:
	return str(Data.def(id).get("desc", ""))
static func cal_short(cal: String) -> String:
	return str(Data.calibers.get(cal, {}).get("short", cal))
static func cal_name(cal: String) -> String:
	return str(Data.calibers.get(cal, {}).get("name", cal))
const AMMO_TAG := { "fmj": "FMJ", "hp": "HP", "ap": "AP", "sub": "SUB", "tracer": "TR", "buck": "BUCK", "slug": "SLUG", "flechette": "FLECH" }
static func ammo_tag(id: String) -> String:
	var a: Dictionary = Data.ammo.get(id, {})
	if a.is_empty(): return ""
	if a.get("blunt", false): return "RUBBER"
	return AMMO_TAG.get(str(a.get("kind", "")), str(a.get("kind", "")).to_upper())
static func ammo_label(id: String) -> String:
	var a: Dictionary = Data.ammo.get(id, {})
	if a.is_empty(): return name_of(id)
	return "%s %s" % [cal_short(str(a.get("cal", ""))), ammo_tag(id)]

## Rounds in the gun as the manifest prints it: "17 / 30 FMJ +1".
static func mag_text(w: Dictionary) -> String:
	var d: Dictionary = Data.weapons.get(str(w.get("id", "")), {})
	if d.is_empty(): return ""
	var s := ""
	var internal := int(d.get("internal", 0))
	if internal > 0:
		var tube: Array = w.get("tube", [])
		s = "%d / %d" % [tube.size(), internal]
		if tube.size() > 0: s += " " + ammo_tag(str(tube[tube.size() - 1]))
	elif w.get("mag") is Dictionary:
		var cap := int(Data.magazines.get(str(w["mag"].get("id", "")), {}).get("cap", 0))
		s = "%d / %d" % [int(w["mag"].get("rounds", 0)), cap]
		if w["mag"].get("ammo") != null: s += " " + ammo_tag(str(w["mag"]["ammo"]))
	else:
		s = "no magazine"
	if w.get("chamber") != null: s += " +1"
	return s

## The one line under a weapon's name in a list.
static func weapon_sub(w: Dictionary) -> String:
	var d: Dictionary = Data.weapons.get(str(w.get("id", "")), {})
	if d.is_empty(): return ""
	var parts: Array[String] = []
	for r in w.get("rails", []): parts.append(name_of(str(r)))
	for v in w.get("attachments", {}).values(): parts.append(name_of(str(v)))
	var s := "%s · %s · %d %%" % [cal_short(str(d.get("cal", ""))), mag_text(w), roundi(condition_of(w))]
	if w.get("jammed", false): s += " · stoppage"
	if not parts.is_empty(): s += " · " + ", ".join(parts)
	return s
static func mag_sub(m: Dictionary) -> String:
	var cap := int(Data.magazines.get(str(m.get("id", "")), {}).get("cap", 0))
	var s := "%s · %d / %d" % [cal_short(str(m.get("cal", ""))), int(m.get("rounds", 0)), cap]
	if m.get("ammo") != null and int(m.get("rounds", 0)) > 0: s += " " + ammo_tag(str(m["ammo"]))
	return s
static func gear_sub(g: Dictionary) -> String:
	var d := Data.def(str(g.get("id", "")))
	if d.is_empty(): return ""
	var p: Array[String] = []
	if d.get("cls") != null: p.append("class %s" % str(d["cls"]))
	if d.get("durability") != null: p.append("%d / %d" % [roundi(float(g.get("durability", d["durability"]))), int(d["durability"])])
	if d.get("capacity") != null: p.append("+%s kg" % str(d["capacity"]))
	if d.get("readyMags") != null: p.append("%d pouches" % int(d["readyMags"]))
	if g.get("charge") != null: p.append("%s %d %%" % ["filter" if d.get("filter") != null else "cell", roundi(float(g["charge"]))])
	if d.get("nvg") != null: p.append("generation %s" % str(d["nvg"]))
	if d.get("gas") != null: p.append("gas %d %%" % roundi(float(d["gas"]) * 100.0))
	if d.get("damage") != null: p.append("damage %s" % str(d["damage"]))
	return " · ".join(p)
static func condition_of(w: Dictionary) -> float:
	var p: Dictionary = w.get("parts", {})
	return minf(minf(float(p.get("barrel", 100.0)), float(p.get("bolt", 100.0))), float(p.get("frame", 100.0)))

## Probability a round of penetration class `pen` defeats armour class `cls` at durability fraction `dur`.
static func pen_chance(pen: float, cls: float, dur: float = 1.0) -> float:
	var eff := cls * (0.55 + 0.45 * dur)
	var x := (pen - eff + 1.0) / 2.0
	if x <= 0.0: return 0.0
	if x >= 1.0: return 1.0
	return x * x * (3.0 - 2.0 * x)

## Attachment effects as a sentence: "1.5× zoom · recoil −18 % · noise −70 %".
static func effects_text(e: Dictionary) -> String:
	if e == null or e.is_empty(): return ""
	var out: Array[String] = []
	if e.get("zoom") != null and float(e["zoom"]) != 1.0:
		var lo := "%s–" % str(e["zoomLow"]) if e.get("zoomLow") != null else ""
		out.append("%s%s× zoom" % [lo, String.num(float(e["zoom"]), 1).trim_suffix(".0")])
	elif e.get("reticle") != null:
		out.append("%s sight" % str(e["reticle"]))
	for pair in [["recoil", "recoil"], ["moa", "dispersion"], ["noise", "noise"], ["flash", "flash"], ["adsSpeed", "aim speed"], ["wear", "wear"]]:
		var k: String = pair[0]
		if e.get(k) != null and float(e[k]) != 1.0:
			var v := float(e[k])
			out.append("%s %s%d %%" % [pair[1], "+" if v > 1.0 else "−", roundi(absf(v - 1.0) * 100.0)])
	if e.get("ergo") != null and float(e["ergo"]) != 0.0:
		out.append("handling %s%d" % ["+" if float(e["ergo"]) > 0.0 else "−", roundi(absf(float(e["ergo"])) * 100.0)])
	if float(e.get("light", 0.0)) > 0.0: out.append("weapon light")
	if e.get("laser", false): out.append("laser")
	if e.get("nvOptic", false): out.append("night optic")
	if e.get("prone", false): out.append("rest when crouched")
	return " · ".join(out)

# ------------------------------------------------------------------------------------------------------------------
# generated stock: fibre grain (tiles) and the stain/light wash (stretched)
# ------------------------------------------------------------------------------------------------------------------
static func _hash2(x: int, y: int) -> float:
	var h := (x * 374761393 + y * 668265263) & 0x7fffffff
	h = (h ^ (h >> 13)) * 1274126177
	return float((h ^ (h >> 16)) & 0xffff) / 65535.0

static func fibre_texture() -> Texture2D:
	if _fibre != null: return _fibre
	var n := 256
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	# three sets of laid lines at rational angles so the tile repeats, plus a fine speckle and a few long fibres
	var sets := [[3, 1, 5.0, 0.030], [-2, 3, 7.0, 0.024], [1, 4, 11.0, 0.020]]
	for y in n:
		for x in n:
			var a := 0.0
			for s in sets:
				var px := float((x * int(s[0]) + y * int(s[1])) % n) / float(n)
				var t: float = fposmod(px * float(s[2]), 1.0)
				a += float(s[3]) * (1.0 - absf(t * 2.0 - 1.0))
			a += _hash2(x, y) * 0.030
			a += (1.0 if _hash2(x * 7 + 3, y * 5 + 1) > 0.994 else 0.0) * 0.10
			img.set_pixel(x, y, Color(INK.r, INK.g, INK.b, clampf(a, 0.0, 0.22)))
	_fibre = ImageTexture.create_from_image(img)
	return _fibre

static func stain_texture() -> Texture2D:
	if _stain != null: return _stain
	var n := 128
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var blots := [[0.10, 0.07, 0.46, 0.20, Color(0.47, 0.34, 0.17)], [0.94, 0.95, 0.40, 0.24, Color(0.33, 0.24, 0.11)],
		[0.68, 0.26, 0.55, -0.13, Color(1.0, 1.0, 0.96)], [0.30, 0.82, 0.34, 0.10, Color(0.40, 0.30, 0.14)]]
	for y in n:
		for x in n:
			var u := float(x) / float(n - 1); var v := float(y) / float(n - 1)
			var col := Color(0, 0, 0, 0)
			for b in blots:
				var d := Vector2(u - float(b[0]), (v - float(b[1])) * 0.86).length() / float(b[2])
				var k: float = clampf(1.0 - d, 0.0, 1.0)
				k = k * k * (3.0 - 2.0 * k)
				var amt: float = k * float(b[3])
				if amt > 0.0:
					var c: Color = b[4]
					col = Color(c.r, c.g, c.b, minf(0.6, col.a + amt))
			img.set_pixel(x, y, col)
	_stain = ImageTexture.create_from_image(img)
	return _stain

# ------------------------------------------------------------------------------------------------------------------
# theme: the panel agent's own, or the shared scenes/ui/theme.tres when that exists
# ------------------------------------------------------------------------------------------------------------------
static func shared_theme() -> Theme:
	if not _ext_theme_checked:
		_ext_theme_checked = true
		if ResourceLoader.exists("res://scenes/ui/theme.tres"):
			var r: Variant = load("res://scenes/ui/theme.tres")
			if r is Theme: _ext_theme = r
	return _ext_theme

static func _flat(bg: Color, border: Color, bw: int = 0, pad := Vector4(8, 4, 8, 4)) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	if bw > 0:
		s.border_color = border
		s.set_border_width_all(bw)
	s.content_margin_left = pad.x; s.content_margin_top = pad.y; s.content_margin_right = pad.z; s.content_margin_bottom = pad.w
	s.corner_detail = 1
	return s

## The panel theme: the shared theme (another agent owns it) plus the two variations the forms add. When the
## shared theme is missing a minimal one is built here so the panels still open and screenshot.
static func theme() -> Theme:
	if _theme != null: return _theme
	var shared := shared_theme()
	var t: Theme = shared.duplicate(true) if shared != null else _fallback_theme()
	# a focusable manifest line: flat, with the amber left edge when it takes focus or is selected
	if not t.has_stylebox("normal", "PaperRow"):
		t.set_type_variation("PaperRow", "Button")
		var flat := _flat(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(8, 5, 8, 5))
		var hover := _flat(amber(0.08), Color(0, 0, 0, 0), 0, Vector4(8, 5, 8, 5))
		var pick := StyleBoxFlat.new()
		pick.bg_color = amber(0.12); pick.border_color = AMBER; pick.border_width_left = 2
		pick.content_margin_left = 8; pick.content_margin_top = 5; pick.content_margin_right = 8; pick.content_margin_bottom = 5
		pick.corner_detail = 1
		t.set_stylebox("normal", "PaperRow", flat)
		t.set_stylebox("hover", "PaperRow", hover)
		t.set_stylebox("pressed", "PaperRow", pick)
		t.set_stylebox("focus", "PaperRow", pick)
		t.set_stylebox("disabled", "PaperRow", flat)
		t.set_font("font", "PaperRow", font("mono"))
		t.set_font_size("font_size", "PaperRow", S_SMALL)
		t.set_color("font_color", "PaperRow", INK)
	_theme = t
	return _theme

static func _fallback_theme() -> Theme:
	var t := Theme.new()
	t.default_font = font("mono")
	t.default_font_size = S_SMALL
	t.set_color("font_color", "Label", INK)
	var norm := _flat(Color(0, 0, 0, 0), ink(0.34), 1, Vector4(9, 3, 9, 3))
	var hover := _flat(amber(0.09), AMBER, 1, Vector4(9, 3, 9, 3))
	t.set_stylebox("normal", "Button", norm)
	t.set_stylebox("hover", "Button", hover)
	t.set_stylebox("pressed", "Button", hover)
	t.set_stylebox("focus", "Button", hover)
	t.set_stylebox("disabled", "Button", _flat(Color(0, 0, 0, 0), ink(0.14), 1, Vector4(9, 3, 9, 3)))
	t.set_font("font", "Button", font("caps"))
	t.set_font_size("font_size", "Button", S_MICRO)
	t.set_color("font_color", "Button", INK)
	t.set_color("font_hover_color", "Button", AMBER)
	t.set_color("font_pressed_color", "Button", AMBER)
	t.set_color("font_focus_color", "Button", AMBER)
	t.set_color("font_disabled_color", "Button", ink(0.34))
	for v in ["Act", "Register", "Tab"]:
		t.set_type_variation(v, "Button")
	t.set_stylebox("panel", "PanelContainer", _flat(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(0, 0, 0, 0)))
	t.set_stylebox("sheet", "Radius", _flat(PAPER, ink(0.5), 1, Vector4(22, 16, 22, 16)))
	return t
