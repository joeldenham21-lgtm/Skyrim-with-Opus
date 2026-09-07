shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
// The Column (mode 0) and the distortion sphere (mode 1) of the Pechorsk Anomaly: the scene behind is read from the
// screen and refracted through slow shimmering noise, then a pale emission is layered on: rising streaks up the
// column, a fresnel rim and a breathing interior for the sphere. Faint by day, glowing by night.
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform int mode = 0;
uniform float night = 0.0;
uniform float tide = 0.0;
uniform float lightning = 0.0;
uniform float energy = 0.3;        // emission scale, set per frame by the script
uniform float t = 0.0;
uniform float height = 2200.0;
uniform vec3 core_color : source_color = vec3(0.75, 0.82, 0.92);
uniform vec3 edge_color : source_color = vec3(0.95, 0.9, 1.0);
varying vec3 v_local;
varying vec3 v_wnormal;

float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }

void vertex() {
	v_local = VERTEX;
	v_wnormal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = normalize(NORMAL);
	vec3 v = normalize(VIEW);
	float facing = abs(dot(n, v));
	float h = clamp(v_local.y / height + 0.5, 0.0, 1.0);
	float ang = atan(v_wnormal.x, v_wnormal.z);
	float a;
	vec3 glow;
	vec2 refr;
	if (mode == 0) {
		float core = pow(facing, 2.2);
		float streaks = fbm(vec2(ang * 3.0, h * 60.0 - t * 0.06));
		float streaks2 = fbm(vec2(ang * 7.0 + 3.0, h * 140.0 - t * 0.11));
		float s = streaks * 0.65 + streaks2 * 0.35;
		float tall = exp(-h * 4.5) * (1.0 - h);
		a = core * (0.35 + 0.65 * s) * tall * smoothstep(0.0, 0.03, h) * 0.6;
		glow = mix(core_color, edge_color, s) * energy * (0.45 + 1.1 * night);
		refr = (vec2(vnoise(vec2(ang * 12.0, h * 300.0 - t * 0.2)), vnoise(vec2(ang * 12.0 + 5.0, h * 300.0 - t * 0.17))) - 0.5) * 0.012 * core;
	} else {
		float cells = fbm(vec2(ang * 2.0 + t * 0.02, v_local.y * 0.01 + t * 0.03));
		float rim = pow(1.0 - facing, 3.0) * (0.4 + 0.6 * smoothstep(0.3, 0.7, cells));
		float breathe = 0.5 + 0.5 * sin(t * 0.35);
		a = (rim * 0.5 + 0.06 * cells) * (0.6 + 0.4 * breathe);
		glow = mix(core_color, edge_color, cells) * energy * (0.35 + 1.0 * night) * (rim * 1.2 + 0.1);
		refr = (vec2(cells, fbm(vec2(ang * 3.0 - t * 0.02, v_local.y * 0.02))) - 0.5) * 0.05 * (1.0 - rim * 0.5);
	}
	vec3 bg = texture(screen_tex, clamp(SCREEN_UV + refr, vec2(0.001), vec2(0.999))).rgb;
	vec3 col = bg + glow * a + vec3(0.4, 0.45, 0.6) * lightning * a * 0.5;
	col = mix(col, vec3(1.0), tide);
	ALBEDO = col;
	ALPHA = clamp(a * 1.2, 0.0, 1.0) * (1.0 - tide * 0.5) + tide * 0.2;
}
