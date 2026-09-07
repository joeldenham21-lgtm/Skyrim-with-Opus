shader_type canvas_item;
render_mode unshaded;
// RADIUS — optic and binocular surround. The reticle itself is drawn by scripts/ui/widgets/reticle.gd;
// this pass only does what the glass does: a black tube surround, a soft edge, a little barrel and a
// chromatic fringe near the rim, plus the shadow crescent of an imperfect eye relief.
// kind 0 = magnified rifle optic (round, tight), 1 = binoculars (two circles merged), 2 = red dot tube.

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform float amount : hint_range(0.0, 1.0) = 0.0;
uniform int kind : hint_range(0, 2) = 0;
uniform float radius : hint_range(0.1, 0.8) = 0.36;
uniform float shadow : hint_range(0.0, 1.0) = 0.35;   // eye-relief crescent
uniform vec2 shadow_dir = vec2(0.35, -0.2);
uniform float aspect = 1.7777;

void fragment() {
	vec3 src = texture(screen_tex, SCREEN_UV).rgb;
	if (amount < 0.001) {
		COLOR = vec4(src, 1.0);
	} else {
		vec2 c = (SCREEN_UV - 0.5) * vec2(aspect, 1.0);
		float d;
		if (kind == 1) {
			float a = length(c - vec2(-0.16, 0.0)) - radius;
			float b = length(c - vec2(0.16, 0.0)) - radius;
			d = min(a, b);
		} else {
			d = length(c) - radius;
		}
		// slight barrel inside the glass
		float rr = length(c) / max(radius, 0.001);
		vec2 uv = SCREEN_UV + (SCREEN_UV - 0.5) * (rr * rr) * 0.010 * float(kind == 0 ? 1 : 0);
		vec3 col;
		float fr = 0.0016 * smoothstep(0.35, 1.0, rr);
		col.r = texture(screen_tex, clamp(uv + vec2(fr, 0.0), vec2(0.001), vec2(0.999))).r;
		col.g = texture(screen_tex, clamp(uv, vec2(0.001), vec2(0.999))).g;
		col.b = texture(screen_tex, clamp(uv - vec2(fr, 0.0), vec2(0.001), vec2(0.999))).b;

		// eye-relief crescent: the tube shades one side
		float cres = smoothstep(0.15, 1.0, dot(normalize(c + vec2(1e-5)), normalize(shadow_dir)) * rr);
		col *= 1.0 - cres * shadow;
		col *= 1.0 - smoothstep(0.55, 1.0, rr) * 0.35;

		float edge = smoothstep(-0.006, 0.006, d);
		col = mix(col, vec3(0.004, 0.004, 0.004), edge);
		COLOR = vec4(mix(src, col, amount), 1.0);
	}
}
