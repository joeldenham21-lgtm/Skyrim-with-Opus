extends Control
class_name WatchFace
## Committee-issue wrist instrument. Drawn, not textured: a steel case with a knurled bezel, a rotating
## compass ring, a dark dial with lume plots and hour/minute/second hands, a day aperture, a condition
## sub-dial, and a recessed module in the lower case carrying the Tide countdown, the heading and the
## cell charges of the torch, headlamp and night vision.
##
## Set the fields and call queue_redraw(); scripts/ui/hud.gd does that once per frame while the watch is up.
##   heading   radians, 0 = north, grows clockwise (the player's compass bearing)
##   hour      0..24 in-game hours (drives the hands)
##   day       day counter
##   tide_text "2d 14h" / "48m" / "NOW"
##   tide_soon true under one hour: the countdown goes red
##   night     0..1 — the lume comes up and the steel goes dim
##   hp        0..100 condition sub-dial
##   explorer  the number printed on the dial
##   cells     { "torch": 0..100, "headlamp": 0..100 or -1, "nvg": 0..100 or -1, "cells": int }

var heading := 0.0
var hour := 7.0
var day := 1
var tide_text := "--"
var tide_soon := false
var night := 0.0
var hp := 100.0
var explorer := 61
var cells := {}
var second_phase := 0.0

const CASE := Vector2(172.0, 158.0)
const R_OUT := 136.0
const R_BEZEL := 110.0
const R_RING := 86.0
const R_DIAL := 84.0

func _ready() -> void:
	custom_minimum_size = Vector2(344.0, 446.0)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	var lume_on: float = clampf(night * 1.15, 0.0, 1.0)
	_draw_strap()
	_draw_case(lume_on)
	_draw_compass_ring(lume_on)
	_draw_dial(lume_on)
	_draw_subdial()
	_draw_day_window()
	_draw_hands(lume_on)
	_draw_module()

# ── strap ──────────────────────────────────────────────────────────────────────────────────────────────
func _draw_strap() -> void:
	var leather := Color(0.078, 0.070, 0.060)
	var edge := Color(0.128, 0.113, 0.094)
	var w := 104.0
	var x := CASE.x - w * 0.5
	draw_rect(Rect2(x, -60.0, w, 236.0), leather, true)
	draw_rect(Rect2(x, 140.0, w, 320.0), leather, true)
	# stitching down both edges
	for side in [x + 9.0, x + w - 9.0]:
		var yy := -50.0
		while yy < 452.0:
			draw_line(Vector2(side, yy), Vector2(side, yy + 6.0), Color(0.30, 0.26, 0.20, 0.55), 1.0, false)
			yy += 13.0
	draw_line(Vector2(x, -60.0), Vector2(x, 452.0), edge, 1.0, false)
	draw_line(Vector2(x + w, -60.0), Vector2(x + w, 452.0), edge, 1.0, false)
	# a worn crease across the leather
	draw_line(Vector2(x + 4.0, 402.0), Vector2(x + w - 4.0, 398.0), Color(0.13, 0.115, 0.095, 0.8), 2.0, false)

# ── case and bezel ─────────────────────────────────────────────────────────────────────────────────────
func _draw_case(lume_on: float) -> void:
	var steel := Color(0.415, 0.420, 0.408).darkened(night * 0.42)
	# lugs
	for s in [-1.0, 1.0]:
		var pts := PackedVector2Array([
			CASE + Vector2(-52.0, s * 112.0), CASE + Vector2(52.0, s * 112.0),
			CASE + Vector2(46.0, s * 158.0), CASE + Vector2(-46.0, s * 158.0)])
		draw_colored_polygon(pts, steel.darkened(0.35))
		draw_polyline(pts, Color(0.0, 0.0, 0.0, 0.5), 1.0, false)
	# the case body: brushed steel ring
	UIStyle.brushed_disc(self, CASE, R_BEZEL - 2.0, R_OUT, steel, 41)
	# knurled edge
	var notches := 72
	for i in notches:
		var a := TAU * float(i) / float(notches)
		var d := Vector2(cos(a), sin(a))
		var k := 0.55 + 0.45 * cos(a + 2.3)
		var c := Color(steel.r * (0.45 + k * 0.5), steel.g * (0.45 + k * 0.5), steel.b * (0.45 + k * 0.5))
		draw_line(CASE + d * (R_OUT - 7.0), CASE + d * R_OUT, c.darkened(0.25) if i % 2 == 0 else c.lightened(0.12), 2.0, false)
	UIStyle.ring(self, CASE, R_OUT, Color(0.06, 0.06, 0.055, 0.85), 1.0)
	UIStyle.ring(self, CASE, R_OUT - 7.5, Color(0.72, 0.73, 0.71, 0.16 * (1.0 - night * 0.6)), 1.0)
	UIStyle.ring(self, CASE, R_BEZEL, Color(0.05, 0.05, 0.045, 0.9), 1.0)
	# bezel index: a lume triangle at 12
	var tri := PackedVector2Array([CASE + Vector2(0.0, -(R_OUT - 5.0)), CASE + Vector2(-7.0, -(R_BEZEL + 3.0)), CASE + Vector2(7.0, -(R_BEZEL + 3.0))])
	draw_colored_polygon(tri, UIStyle.LUME.lerp(Color(0.86, 0.90, 0.84), 0.4) if lume_on > 0.2 else Color(0.80, 0.80, 0.76))
	if lume_on > 0.05:
		draw_colored_polygon(tri, Color(UIStyle.LUME.r, UIStyle.LUME.g, UIStyle.LUME.b, 0.30 * lume_on))

# ── compass ring ───────────────────────────────────────────────────────────────────────────────────────
func _draw_compass_ring(lume_on: float) -> void:
	# the ring sits between R_RING and R_BEZEL and turns so that N points at true north
	draw_circle(CASE, R_BEZEL - 1.0, Color(0.085, 0.088, 0.082))
	var rot := -heading
	var f := UIStyle.font(self, "caps")
	var fs := 13
	for i in 72:
		var a := TAU * float(i) / 72.0 + rot - PI * 0.5
		var d := Vector2(cos(a), sin(a))
		var major := i % 6 == 0
		var mid := i % 3 == 0
		var l := 9.0 if major else (6.0 if mid else 3.0)
		var c := Color(0.72, 0.72, 0.68, 0.85 if major else 0.42)
		draw_line(CASE + d * (R_RING + 2.0), CASE + d * (R_RING + 2.0 + l), c, 1.0 if not major else 1.6, false)
	var cards := [["N", 0.0], ["E", 90.0], ["S", 180.0], ["W", 270.0]]
	for cd in cards:
		var a: float = deg_to_rad(float(cd[1])) + rot - PI * 0.5
		var d := Vector2(cos(a), sin(a))
		var p: Vector2 = CASE + d * (R_RING + 13.0)
		var txt: String = str(cd[0])
		var is_n: bool = txt == "N"
		var col := UIStyle.RED.lerp(Color(0.95, 0.55, 0.42), 0.3) if is_n else Color(0.80, 0.80, 0.76)
		var sz := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		draw_set_transform(p, a + PI * 0.5, Vector2.ONE)
		draw_string(f, Vector2(-sz.x * 0.5, sz.y * 0.34), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	for cd in [["NE", 45.0], ["SE", 135.0], ["SW", 225.0], ["NW", 315.0]]:
		var a: float = deg_to_rad(float(cd[1])) + rot - PI * 0.5
		var d := Vector2(cos(a), sin(a))
		draw_line(CASE + d * (R_RING + 9.0), CASE + d * (R_RING + 16.0), Color(0.62, 0.62, 0.58, 0.6), 1.0, false)
	UIStyle.ring(self, CASE, R_RING + 1.0, Color(0.04, 0.04, 0.04, 0.9), 1.0)

# ── dial ───────────────────────────────────────────────────────────────────────────────────────────────
func _draw_dial(lume_on: float) -> void:
	var dial := Color(0.072, 0.079, 0.075).lerp(Color(0.055, 0.062, 0.058), night)
	draw_circle(CASE, R_DIAL, dial)
	# sunburst-free matte texture: faint concentric hairlines
	for i in 9:
		UIStyle.ring(self, CASE, 12.0 + float(i) * 8.4, Color(1.0, 1.0, 1.0, 0.012), 1.0)
	# chapter ring
	for i in 60:
		var a := TAU * float(i) / 60.0 - PI * 0.5
		var d := Vector2(cos(a), sin(a))
		var hourm := i % 5 == 0
		var l := 8.0 if hourm else 4.0
		var c := Color(0.78, 0.78, 0.74, 0.9 if hourm else 0.34)
		draw_line(CASE + d * (R_DIAL - 5.0), CASE + d * (R_DIAL - 5.0 - l), c, 1.6 if hourm else 1.0, false)
	# lume plots at the hours (skipping 3 and 9 where the aperture and the sub-dial sit)
	for i in 12:
		if i == 3 or i == 9 or i == 0 or i == 6:
			continue
		var a := TAU * float(i) / 12.0 - PI * 0.5
		var d := Vector2(cos(a), sin(a))
		var p: Vector2 = CASE + d * (R_DIAL - 22.0)
		var base := Color(0.74, 0.76, 0.68).lerp(UIStyle.LUME, lume_on * 0.8)
		if lume_on > 0.05:
			draw_circle(p, 8.0, Color(UIStyle.LUME.r, UIStyle.LUME.g, UIStyle.LUME.b, 0.10 * lume_on))
			draw_circle(p, 5.4, Color(UIStyle.LUME.r, UIStyle.LUME.g, UIStyle.LUME.b, 0.16 * lume_on))
		draw_circle(p, 3.6, base)
		UIStyle.ring(self, p, 3.6, Color(0.0, 0.0, 0.0, 0.4), 1.0)
	# numerals at 12 and 6
	var fnum := UIStyle.font(self, "figure")
	for pair in [["12", -PI * 0.5], ["6", PI * 0.5]]:
		var a: float = float(pair[1])
		var p: Vector2 = CASE + Vector2(cos(a), sin(a)) * (R_DIAL - 23.0)
		var txt: String = str(pair[0])
		var sz := fnum.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 22)
		var c := Color(0.80, 0.81, 0.76).lerp(UIStyle.LUME, lume_on * 0.5)
		draw_string(fnum, p - Vector2(sz.x * 0.5, -sz.y * 0.33), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 22, c)
	# printing on the dial
	var fc := UIStyle.font(self, "caps")
	_centred(fc, CASE + Vector2(0.0, -34.0), "UNPSC", 11, Color(0.70, 0.70, 0.66, 0.80))
	_centred(fc, CASE + Vector2(0.0, -21.0), "PECHORSK", 9, Color(0.60, 0.60, 0.56, 0.55))
	_centred(fc, CASE + Vector2(0.0, 50.0), "EXPLORER %d" % explorer, 9, Color(0.62, 0.62, 0.58, 0.62))

func _centred(f: Font, at: Vector2, txt: String, sz: int, col: Color) -> void:
	var s := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, sz)
	draw_string(f, at - Vector2(s.x * 0.5, 0.0), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, col)

# ── condition sub-dial at 9 ────────────────────────────────────────────────────────────────────────────
func _draw_subdial() -> void:
	var c: Vector2 = CASE + Vector2(-44.0, 0.0)
	var r := 25.0
	draw_circle(c, r, Color(0.045, 0.050, 0.047))
	UIStyle.ring(self, c, r, Color(0.0, 0.0, 0.0, 0.5), 1.0)
	# scale sweeps from 210 deg to 330 deg (i.e. bottom-left up over the top to bottom-right)
	var a0 := deg_to_rad(140.0)
	var a1 := deg_to_rad(400.0)
	for i in 11:
		var t := float(i) / 10.0
		var a: float = lerp(a0, a1, t)
		var d := Vector2(cos(a), sin(a))
		var maj := i % 5 == 0
		draw_line(c + d * (r - 3.0), c + d * (r - (8.0 if maj else 5.0)), Color(0.72, 0.72, 0.68, 0.75 if maj else 0.35), 1.0, false)
	# the red sector below 30
	draw_arc(c, r - 5.5, a0, lerp(a0, a1, 0.3), 18, Color(UIStyle.RED.r, UIStyle.RED.g, UIStyle.RED.b, 0.75), 2.0, false)
	var t := clampf(hp / 100.0, 0.0, 1.0)
	var na: float = lerp(a0, a1, t)
	var nd := Vector2(cos(na), sin(na))
	var col := UIStyle.RED if hp < 30.0 else Color(0.86, 0.86, 0.82)
	draw_line(c - nd * 4.0, c + nd * (r - 6.0), col, 1.8, false)
	draw_circle(c, 2.6, Color(0.58, 0.58, 0.55))
	_centred(UIStyle.font(self, "caps"), c + Vector2(0.0, 15.0), "COND", 8, Color(0.58, 0.58, 0.54, 0.7))

# ── day aperture at 3 ──────────────────────────────────────────────────────────────────────────────────
func _draw_day_window() -> void:
	var r := Rect2(CASE.x + 30.0, CASE.y - 12.0, 44.0, 24.0)
	draw_rect(r, Color(0.83, 0.82, 0.78), true)
	draw_rect(r, Color(0.0, 0.0, 0.0, 0.55), false, 1.0)
	var f := UIStyle.font(self, "mono_semibold")
	var txt := "D%d" % day
	var s := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 15)
	draw_string(f, Vector2(r.position.x + (r.size.x - s.x) * 0.5, r.position.y + 17.0), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(0.10, 0.10, 0.09))

# ── hands ──────────────────────────────────────────────────────────────────────────────────────────────
func _hand(angle: float, length: float, back: float, w0: float, w1: float, col: Color, lume: float, lume_col: Color) -> void:
	var d := Vector2(cos(angle), sin(angle))
	var n := Vector2(-d.y, d.x)
	var pts := PackedVector2Array([
		CASE - d * back + n * w0 * 0.5, CASE + d * (length * 0.72) + n * w1 * 0.5,
		CASE + d * length, CASE + d * (length * 0.72) - n * w1 * 0.5, CASE - d * back - n * w0 * 0.5])
	if lume > 0.05:
		var glow := PackedVector2Array()
		for p in pts:
			glow.append(CASE + (p - CASE) * 1.0 + (p - CASE).normalized() * 2.0)
		draw_colored_polygon(pts, Color(lume_col.r, lume_col.g, lume_col.b, 0.16 * lume))
	draw_colored_polygon(pts, col)
	draw_polyline(pts, Color(0.0, 0.0, 0.0, 0.45), 1.0, false)
	# lume stripe down the middle
	var stripe := PackedVector2Array([
		CASE + d * (length * 0.24) + n * (w1 * 0.22), CASE + d * (length * 0.90) + n * (w1 * 0.16),
		CASE + d * (length * 0.90) - n * (w1 * 0.16), CASE + d * (length * 0.24) - n * (w1 * 0.22)])
	draw_colored_polygon(stripe, Color(0.74, 0.78, 0.68).lerp(lume_col, lume))

func _draw_hands(lume_on: float) -> void:
	var h := fmod(hour, 12.0)
	var m := fmod(hour, 1.0) * 60.0
	var ha := (h / 12.0) * TAU - PI * 0.5
	var ma := (m / 60.0) * TAU - PI * 0.5
	var sa := fmod(second_phase, 60.0) / 60.0 * TAU - PI * 0.5
	var steel := Color(0.86, 0.87, 0.83)
	_hand(ha, 46.0, 14.0, 11.0, 9.0, steel, lume_on, UIStyle.LUME)
	_hand(ma, 72.0, 16.0, 9.0, 6.5, steel, lume_on, UIStyle.LUME)
	# seconds: a thin rust needle with a counterweight
	var d := Vector2(cos(sa), sin(sa))
	draw_line(CASE - d * 20.0, CASE + d * 76.0, Color(0.68, 0.32, 0.20), 1.6, false)
	draw_circle(CASE - d * 20.0, 4.0, Color(0.68, 0.32, 0.20))
	draw_circle(CASE, 5.0, Color(0.55, 0.56, 0.53))
	draw_circle(CASE, 2.0, Color(0.10, 0.10, 0.09))

# ── the Committee module in the lower case ─────────────────────────────────────────────────────────────
func _draw_module() -> void:
	var r := Rect2(30.0, 300.0, 284.0, 118.0)
	# recessed steel frame
	var steel := Color(0.36, 0.365, 0.355).darkened(night * 0.4)
	draw_rect(Rect2(r.position - Vector2(9.0, 9.0), r.size + Vector2(18.0, 18.0)), steel.darkened(0.15), true)
	draw_rect(Rect2(r.position - Vector2(9.0, 9.0), r.size + Vector2(18.0, 18.0)), Color(0.0, 0.0, 0.0, 0.5), false, 1.0)
	draw_rect(r, Color(0.055, 0.060, 0.056), true)
	draw_rect(r, Color(0.0, 0.0, 0.0, 0.6), false, 1.0)
	# screws
	for p in [r.position + Vector2(-4.5, -4.5), r.position + Vector2(r.size.x + 4.5, -4.5),
			r.position + Vector2(-4.5, r.size.y + 4.5), r.position + Vector2(r.size.x + 4.5, r.size.y + 4.5)]:
		draw_circle(p, 3.0, steel.darkened(0.45))
		draw_line(p + Vector2(-2.0, -2.0), p + Vector2(2.0, 2.0), Color(0.0, 0.0, 0.0, 0.6), 1.0, false)

	var fc := UIStyle.font(self, "caps")
	var fm := UIStyle.font(self, "mono")
	var ff := UIStyle.font(self, "figure")
	var x := r.position.x + 12.0
	var y := r.position.y + 20.0
	draw_string(fc, Vector2(x, y), "TIDE", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(0.62, 0.62, 0.58, 0.8))
	var tcol := UIStyle.RED if tide_soon else Color(0.86, 0.86, 0.82)
	draw_string(ff, Vector2(x + 52.0, y + 6.0), tide_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 26, tcol)
	UIStyle.hairline(self, Vector2(x, y + 16.0), Vector2(r.end.x - 12.0, y + 16.0), Color(0.75, 0.75, 0.70), 0.16)

	y += 40.0
	var hdg := int(round(rad_to_deg(fposmod(heading, TAU))))
	var line := "%02d:%02d   DAY %d   %03d°" % [int(hour), int(fmod(hour, 1.0) * 60.0), day, hdg]
	draw_string(fm, Vector2(x, y), line, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.80, 0.80, 0.76, 0.92))

	y += 20.0
	draw_string(fc, Vector2(x, y), "CELL", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(0.62, 0.62, 0.58, 0.8))
	var gx := x + 46.0
	for pair in [["TOR", "torch"], ["LMP", "headlamp"], ["NVG", "nvg"]]:
		var key: String = str(pair[1])
		var v := float(cells.get(key, -1.0))
		draw_string(fc, Vector2(gx, y), str(pair[0]), HORIZONTAL_ALIGNMENT_LEFT, -1, 9, Color(0.58, 0.58, 0.54, 0.75))
		var bar := Rect2(gx, y + 5.0, 46.0, 4.0)
		draw_rect(bar, Color(0.75, 0.75, 0.70, 0.14), true)
		if v >= 0.0:
			var w: float = bar.size.x * clampf(v / 100.0, 0.0, 1.0)
			var c := UIStyle.RED if v < 20.0 else (UIStyle.AMBER if v < 50.0 else Color(0.78, 0.78, 0.74))
			draw_rect(Rect2(bar.position, Vector2(w, bar.size.y)), c, true)
		else:
			draw_line(bar.position + Vector2(0.0, 2.0), bar.position + Vector2(bar.size.x, 2.0), Color(0.55, 0.55, 0.52, 0.35), 1.0, false)
		gx += 60.0
	var spare := int(cells.get("cells", 0))
	draw_string(fm, Vector2(r.end.x - 46.0, y + 8.0), "×%d" % spare, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(0.72, 0.72, 0.68, 0.85))
