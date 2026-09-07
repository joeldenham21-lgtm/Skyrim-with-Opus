shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back, diffuse_burley, specular_schlick_ggx;
// Phantom: a near-invisible refractive silhouette. The screen behind it is sampled with a normal-based offset (and a
// chromatic split), a faint cold rim marks the edge, clouding rises when it is revealed (screams, grabs, gets hit).
// Under night vision (nvg = 1) it is a solid phosphor-bright figure. Cast no shadow: set cast_shadow off on the mesh.
instance uniform float nvg : hint_range(0.0, 1.0) = 0.0;
instance uniform float reveal : hint_range(0.0, 1.0) = 0.0;
instance uniform float shiver : hint_range(0.0, 3.0) = 1.0;
instance uniform float dissolve : hint_range(0.0, 1.0) = 0.0;
instance uniform float seed = 0.0;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform float refraction = 0.05;
uniform vec3 rim_color : source_color = vec3(0.62, 0.86, 1.0);

varying vec3 v_obj;
varying float v_ph;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p) {
	vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
	float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
	return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm3(vec3 p) { return vnoise3(p) * 0.55 + vnoise3(p * 2.03 + 7.1) * 0.3 + vnoise3(p * 4.1 + 3.3) * 0.15; }

void vertex() {
	float ph = hash12(UV * 917.3 + seed);
	v_ph = ph;
	float slot = floor(TIME * 14.0 + ph * 5.0);
	float n1 = hash11(slot + ph * 61.7) - 0.5;
	float amp = shiver * (0.003 + 0.02 * step(0.96, hash11(slot * 0.13 + ph * 3.3)));
	VERTEX += NORMAL * n1 * amp;
	v_obj = VERTEX;
}

void fragment() {
	if (dissolve > 0.0) {
		float dn = fbm3(v_obj * 4.0 + seed);
		if (dn < dissolve * 1.15 - 0.05) discard;
	}
	vec3 n = normalize(NORMAL);
	vec3 v = normalize(-VERTEX);
	float ndv = clamp(dot(n, v), 0.0, 1.0);
	float fres = pow(1.0 - ndv, 2.5);
	// refraction: offset the screen sample by the view-space normal; split channels a little
	vec2 off = n.xy * refraction * (0.6 + 0.4 * fres);
	float r = texture(screen_tex, SCREEN_UV + off * 1.06).r;
	float g = texture(screen_tex, SCREEN_UV + off).g;
	float b = texture(screen_tex, SCREEN_UV + off * 0.94).b;
	vec3 behind = vec3(r, g, b);
	float cloud = fbm3(v_obj * 5.0 + vec3(0.0, -TIME * 0.4, 0.0) + seed);
	float rv = clamp(reveal, 0.0, 1.0);
	// visible: mostly the background, darkened slightly with the reveal, a cold rim and a moving band of shimmer
	float band = 0.5 + 0.5 * sin(v_obj.y * 12.0 - TIME * 3.0 + v_ph * 2.0);
	vec3 col = behind * mix(1.0, 0.55 + 0.25 * cloud, rv);
	vec3 rim = rim_color * fres * (0.35 + rv * 1.6 + band * 0.25);
	vec3 phosphor = vec3(0.82, 1.0, 0.78);
	// night vision: solid, emissive
	ALBEDO = mix(col, vec3(0.05, 0.12, 0.05), nvg);
	EMISSION = mix(rim * 0.8, phosphor * (1.6 + 0.6 * cloud), nvg);
	ALPHA = mix(0.96, 1.0, nvg);
	ROUGHNESS = 0.15;
	SPECULAR = 0.6;
	METALLIC = 0.0;
	// the refraction is unlit: tell the lighting to leave the colour alone except the rim
	ALBEDO = mix(vec3(0.0), ALBEDO, nvg);
	EMISSION += mix(col, vec3(0.0), nvg);
}
