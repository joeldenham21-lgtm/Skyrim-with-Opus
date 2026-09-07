shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_back, fog_disabled, shadows_disabled, specular_disabled;
// The Column (mode 0) and the lens of distortion hanging on it (mode 1), at Data.map.COLUMN in the far north.
//
// Both read the scene behind them from the screen and bend it through slow shimmering noise, then add a pale
// emission on top. Because they are transparent and depth-tested but never write depth, the ridges and the far
// terrain occlude them correctly and they never fight the horizon.
//
// The Column is a cylinder rendered front-face only: for a ray crossing a cylinder of radius R the chord length is
// 2R*|dot(N, V)|, so the alpha is that dot product straight — the shaft is dense along its axis and dissolves at
// its edges like a real volume, with no hard silhouette. Its brightness falls with height (a kilometres-tall
// pillar of light standing on the horizon), rising streaks run up the inside, and the base flares where the light
// meets the haze.
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform int mode = 0;
uniform float night = 0.0;
uniform float tide = 0.0;
uniform float lightning = 0.0;
uniform float energy = 0.3;        // emission scale, set per frame by scripts/world/sky.gd
uniform float t = 0.0;
uniform float height = 2200.0;
uniform float fade = 0.0;          // 1 = swallowed by fog
uniform float refract_amount = 1.0;
uniform vec3 core_color : source_color = vec3(0.72, 0.80, 0.94);
uniform vec3 edge_color : source_color = vec3(0.95, 0.93, 1.0);
varying vec3 v_local;
varying vec3 v_world;
varying vec3 v_wnormal;

float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }

void vertex() {
	v_local = VERTEX;
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnormal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 v = normalize(VIEW);
	float facing = clamp(abs(dot(normalize(v_wnormal), v)), 0.0, 1.0);
	float h = clamp(v_local.y / height + 0.5, 0.0, 1.0);
	float ang = atan(v_wnormal.x, v_wnormal.z);
	float a;
	vec3 glow;
	vec2 refr;
	if (mode == 0) {
		// chord through the shaft, softened at the very edge so there is no rim line
		float chord = facing * smoothstep(0.0, 0.16, facing);
		// rising light inside: slow streaks and a faster fine shimmer, both travelling up
		float streaks = fbm(vec2(ang * 2.2, h * 26.0 - t * 0.055));
		float fine = fbm(vec2(ang * 6.5 + 3.0, h * 90.0 - t * 0.19));
		float s = streaks * 0.66 + fine * 0.34;
		// a kilometres-tall pillar: bright at the foot, thinning with height, never quite gone
		float tall = exp(-h * 2.3) * (1.0 - h * 0.55) + 0.05 * (1.0 - h);
		float foot = exp(-h * 26.0) * 0.7;                      // the flare where it stands in the haze
		a = chord * (0.30 + 0.70 * s) * (tall + foot);
		glow = mix(core_color, edge_color, s * 0.8) * energy * (0.85 + 1.6 * night);
		glow += edge_color * energy * foot * chord * (0.5 + night);
		refr = (vec2(vnoise(vec2(ang * 9.0, h * 160.0 - t * 0.2)), vnoise(vec2(ang * 9.0 + 5.0, h * 160.0 - t * 0.17))) - 0.5) * 0.010 * chord;
	} else {
		// the lens: a refracting shell with a bright rim and a slow interior churn
		float cells = fbm(vec2(ang * 2.0 + t * 0.02, v_local.y * 0.012 + t * 0.03));
		float churn = fbm(vec2(ang * 5.0 - t * 0.05, v_local.y * 0.03 + 2.0));
		float rim = pow(1.0 - facing, 2.2);
		float breathe = 0.5 + 0.5 * sin(t * 0.31);
		a = clamp(rim * 0.75 + 0.16 * facing * (0.4 + 0.6 * cells), 0.0, 1.0) * (0.7 + 0.3 * breathe);
		glow = mix(core_color, edge_color, cells) * energy * (0.8 + 1.7 * night) * (0.35 + 0.9 * rim + 0.25 * churn);
		refr = (vec2(cells - 0.5, churn - 0.5)) * 0.075 * (0.25 + 0.75 * facing);
	}
	a *= 1.0 - fade;
	vec3 bg = texture(screen_tex, clamp(SCREEN_UV + refr * refract_amount, vec2(0.001), vec2(0.999))).rgb;
	vec3 col = bg + glow + vec3(0.45, 0.5, 0.68) * lightning * 0.6;
	col = mix(col, vec3(1.2), tide);
	ALBEDO = col;
	ALPHA = clamp(a, 0.0, 1.0) * (1.0 - tide * 0.4) + tide * 0.25;
}
