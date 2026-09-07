shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back, diffuse_burley, specular_schlick_ggx;
// Fragment glass: the shards and the shell around the core. Fresnel-driven transparency, a sun glint through the
// low roughness, screen refraction with a colour fringe, and an inner pulse (pink → white as it beats faster) that
// bleeds through the glass near the core. pulse and glow are per instance so a cluster beats in its own rhythm.
instance uniform float pulse : hint_range(0.0, 1.0) = 0.0;
instance uniform float glow : hint_range(0.0, 8.0) = 2.5;
instance uniform float shatter : hint_range(0.0, 1.0) = 0.0;
instance uniform float seed = 0.0;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform vec3 color_a : source_color = vec3(1.0, 0.435, 0.66);
uniform vec3 color_b : source_color = vec3(1.0, 0.96, 0.97);
uniform float refraction = 0.03;
uniform float inner = 1.0;   // 1 on the shell/shards near the core, less on far shards (set via COLOR.r)

varying vec3 v_obj;
varying float v_core;

float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p) {
	vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
	float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
	return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

void vertex() {
	v_obj = VERTEX;
	v_core = COLOR.r;
	// shatter: shards fly apart along their normals and lose the core glow
	VERTEX += NORMAL * shatter * 0.25 * (0.5 + hash13(vec3(UV, seed)));
}

void fragment() {
	vec3 n = normalize(NORMAL);
	vec3 v = normalize(-VERTEX);
	float ndv = clamp(dot(n, v), 0.0, 1.0);
	float fres = pow(1.0 - ndv, 3.0);
	vec2 off = n.xy * refraction;
	vec3 behind = vec3(texture(screen_tex, SCREEN_UV + off * 1.08).r, texture(screen_tex, SCREEN_UV + off).g, texture(screen_tex, SCREEN_UV + off * 0.92).b);
	vec3 core_col = mix(color_a, color_b, clamp(pulse * 0.75 + 0.25 * vnoise3(v_obj * 30.0 + TIME), 0.0, 1.0));
	// the core seen through the glass: brightest looking straight through, and near the core (COLOR.r)
	float through = pow(ndv, 2.5) * v_core * inner;
	float haze = 0.12 * v_core * (0.6 + 0.4 * sin(TIME * 6.0 + seed));
	float br = glow * (0.35 + 0.65 * pulse);
	vec3 col = behind * (0.85 + 0.15 * fres);
	ALBEDO = vec3(0.0);
	EMISSION = col * (1.0 - fres * 0.5) * (1.0 - shatter) + core_col * (through * br + haze) * (1.0 - shatter * 0.8) + vec3(0.7, 0.8, 0.9) * fres * 0.25;
	ALPHA = 1.0;
	ROUGHNESS = 0.08;
	SPECULAR = 1.0;
	METALLIC = 0.0;
	RIM = 0.3; RIM_TINT = 0.5;
}
