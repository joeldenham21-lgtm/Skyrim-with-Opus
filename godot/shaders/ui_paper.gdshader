shader_type canvas_item;
render_mode unshaded;
// RADIUS — Committee stock. The only gradient DESIGN.md allows: paper grain. Draw it over a paper-coloured
// panel (scripts/ui/widgets/sheet.gd) at low alpha: fibre lines at two odd angles, a speckle field, foxing
// in two corners and one soft light. Static — paper does not animate.

uniform vec3 tint : source_color = vec3(0.10, 0.09, 0.08);
uniform float strength : hint_range(0.0, 1.0) = 0.5;
uniform vec2 seed = vec2(0.0);

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 uv = UV + seed;
	float a = 0.0;
	// fibre: two sets of fine lines at odd angles
	vec2 r1 = vec2(uv.x * 0.9563 - uv.y * 0.2924, uv.x * 0.2924 + uv.y * 0.9563);
	vec2 r2 = vec2(uv.x * 0.454 + uv.y * 0.891, -uv.x * 0.891 + uv.y * 0.454);
	a += smoothstep(0.55, 1.0, fract(r1.y * 260.0)) * 0.16;
	a += smoothstep(0.62, 1.0, fract(r2.y * 175.0)) * 0.12;
	// speckle
	a += smoothstep(0.72, 1.0, hash12(floor(uv * 620.0))) * 0.14;
	// foxing: two soft stains
	float f1 = 1.0 - smoothstep(0.0, 0.34, length((uv - vec2(0.11, 0.07)) * vec2(1.0, 1.4)));
	float f2 = 1.0 - smoothstep(0.0, 0.30, length((uv - vec2(0.93, 0.95)) * vec2(1.0, 1.3)));
	a += (f1 * 0.9 + f2 * 1.0) * (0.35 + 0.65 * vnoise(uv * 9.0)) * 0.22;
	// broad unevenness
	a += (vnoise(uv * 3.3) - 0.5) * 0.10;
	// one soft light off the top edge lifts the sheet a little
	float lift = (1.0 - smoothstep(0.0, 0.7, length(uv - vec2(0.62, 0.18)))) * 0.10;
	a = max(0.0, a - lift);
	COLOR = vec4(tint, clamp(a * strength, 0.0, 1.0));
}
