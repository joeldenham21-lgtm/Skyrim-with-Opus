shader_type canvas_item;
render_mode unshaded;
// RADIUS — gas mask / respirator field of view. kind 0 = half-mask respirator (a rubber edge low in
// frame), 1 = GP-5 (two round eyepieces), 2 = GP-7 (one wide visor). Rubber surround, condensation at
// the glass rim, scratches, and a breath fog that pulses. Driven by scripts/player/kit.gd mask_def().

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform float amount : hint_range(0.0, 1.0) = 0.0;
uniform int kind : hint_range(0, 2) = 1;
uniform float fog : hint_range(0.0, 1.0) = 0.25;   // condensation, rises while breathing hard
uniform float breath = 0.0;                          // breath phase, seconds
uniform float aspect = 1.7777;

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

// signed distance to the opening; negative inside
float aperture(vec2 c, int k, float wob) {
	if (k == 0) {
		// half mask: the rubber only intrudes at the bottom and the very corners
		float bottom = (c.y - 0.34) * 1.0;
		float corners = length(max(abs(c) - vec2(0.72, 0.40), vec2(0.0))) - 0.20;
		return max(bottom, -0.4 + corners * 0.0) + wob;
	}
	if (k == 1) {
		// GP-5: two round eyepieces, slightly toed-in
		float r1 = length((c - vec2(-0.235, 0.02)) * vec2(1.0, 1.06)) - 0.275;
		float r2 = length((c - vec2(0.235, 0.02)) * vec2(1.0, 1.06)) - 0.275;
		return min(r1, r2) + wob;
	}
	// GP-7: one wide visor, rounded rectangle
	vec2 q = abs(c * vec2(1.0, 1.42)) - vec2(0.50, 0.30);
	return (length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - 0.14) + wob;
}

void fragment() {
	vec3 src = texture(screen_tex, SCREEN_UV).rgb;
	if (amount < 0.001) {
		COLOR = vec4(src, 1.0);
	} else {
		vec2 c = (SCREEN_UV - 0.5) * vec2(aspect, 1.0);
		float wob = (vnoise(c * 7.0) - 0.5) * 0.012;
		float d = aperture(c, kind, wob);

		vec3 col = src;

		// condensation and scratches near the glass edge
		float rim = smoothstep(-0.16, 0.0, d);
		float br = 0.5 + 0.5 * sin(breath * 1.35);
		float mist = rim * (fog * 0.55 + br * fog * 0.45);
		float mistn = vnoise(c * 12.0 + vec2(0.0, breath * 0.05));
		col = mix(col, mix(col, vec3(0.62, 0.64, 0.63), 0.75), clamp(mist * (0.55 + 0.6 * mistn), 0.0, 0.85));
		float scratch = smoothstep(0.86, 1.0, vnoise(vec2(c.x * 60.0, c.y * 6.0)));
		col += scratch * rim * 0.06;

		// rubber: matte, granular, a hint of a highlight where the light catches the top of the mask
		float grain = vnoise(SCREEN_UV * 320.0) * 0.5 + vnoise(SCREEN_UV * 90.0) * 0.5;
		vec3 rubber = vec3(0.030, 0.030, 0.028) * (0.55 + 0.9 * grain);
		rubber += vec3(0.055, 0.055, 0.050) * smoothstep(0.25, -0.35, c.y) * 0.5;
		float edge = smoothstep(0.0, 0.028, d);
		// a soft dark falloff just inside the glass so the opening does not read as a cut circle
		col *= 1.0 - smoothstep(-0.10, 0.005, d) * 0.55;
		col = mix(col, rubber, edge);

		COLOR = vec4(mix(src, col, amount), 1.0);
	}
}
