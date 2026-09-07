shader_type canvas_item;
render_mode unshaded;
// RADIUS — night-vision phosphor. Kit-driven (scripts/player/kit.gd: nvg_on, nvg_gen, nvg_blind).
// Gen 1 is a coarse green tube with heavy scintillation and a tight aperture; gen 3 is a clean white
// phosphor with a wide aperture. Bright sources bloom and, past a point, blind the tube.

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform float amount : hint_range(0.0, 1.0) = 0.0;
uniform float gen : hint_range(1.0, 3.0) = 1.0;
uniform float blind : hint_range(0.0, 1.0) = 0.0;
uniform float aspect = 1.7777;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void fragment() {
	vec3 src = texture(screen_tex, SCREEN_UV).rgb;
	if (amount < 0.001) {
		COLOR = vec4(src, 1.0);
	} else {
		float g = clamp(gen, 1.0, 3.0);
		vec2 c = (SCREEN_UV - 0.5) * vec2(aspect, 1.0);
		float r = length(c);

		// tube gain: lift the shadows hard, roll off the highlights
		float l = dot(src, vec3(0.30, 0.55, 0.15));
		float gain = mix(9.0, 16.0, (g - 1.0) * 0.5);
		float sig = 1.0 - exp(-l * gain);
		sig = pow(sig, mix(0.85, 0.72, (g - 1.0) * 0.5));

		// halo around bright sources (cheap ring of taps)
		float halo = 0.0;
		for (int i = 0; i < 8; i++) {
			float a = float(i) * 0.7853982;
			vec2 o = vec2(cos(a), sin(a)) * 0.012;
			vec3 s = texture(screen_tex, clamp(SCREEN_UV + o, vec2(0.001), vec2(0.999))).rgb;
			halo += max(0.0, dot(s, vec3(0.33)) - 0.42);
		}
		halo = clamp(halo * 0.34, 0.0, 1.2);
		sig += halo * mix(0.7, 0.35, (g - 1.0) * 0.5);

		// scintillation: photon noise, coarser and busier on the older tube
		float grain_scale = mix(520.0, 900.0, (g - 1.0) * 0.5);
		float n = hash12(floor(SCREEN_UV * grain_scale) + vec2(floor(TIME * 30.0) * 13.1, floor(TIME * 30.0) * 7.7));
		float noise_amt = mix(0.30, 0.13, (g - 1.0) * 0.5) * (1.2 - smoothstep(0.1, 0.8, sig));
		sig += (n - 0.5) * noise_amt;

		// phosphor
		vec3 phos = mix(vec3(0.24, 1.0, 0.40), vec3(0.80, 1.0, 0.90), clamp((g - 1.0) * 0.5, 0.0, 1.0));
		vec3 col = phos * clamp(sig, 0.0, 1.6);
		col += phos * halo * 0.25;

		// tube structure: fine honeycomb + a slow horizontal band
		float hex = 0.5 + 0.5 * sin(SCREEN_UV.y * 1500.0);
		col *= 0.94 + 0.06 * hex;
		col *= 0.97 + 0.03 * sin(SCREEN_UV.y * 6.0 + TIME * 0.9);

		// aperture: everything outside the tube is black rubber
		float ap = mix(0.40, 0.50, (g - 1.0) * 0.5);
		float tube = 1.0 - smoothstep(ap * 0.86, ap, r);
		float rim = smoothstep(ap * 0.55, ap * 0.99, r);
		col *= 1.0 - rim * 0.55;
		col = mix(vec3(0.006, 0.010, 0.007), col, tube);

		// blinded tube: the whole field washes to phosphor white
		col = mix(col, phos * 1.35, clamp(blind, 0.0, 1.0) * tube);

		COLOR = vec4(mix(src, col, amount), 1.0);
	}
}
