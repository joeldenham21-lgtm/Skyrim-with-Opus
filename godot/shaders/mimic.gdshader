shader_type spatial;
render_mode cull_back, depth_draw_opaque, diffuse_burley, specular_schlick_ggx;
// Mimic body: matte charcoal with an oil-slick sheen at grazing angles and a TV-static shimmer that crawls along
// the silhouette; edges shiver (vertex jitter at ~20 Hz with per-vertex phase, spikes now and then); noise
// dissolve for the ash death; frayed cloth edges from the tatter channel (COLOR.a). Vertex colour convention:
// r shiver weight, g cloth, b grime, a tatter threshold.
instance uniform float shiver : hint_range(0.0, 3.0) = 1.0;
instance uniform float dissolve : hint_range(0.0, 1.0) = 0.0;
instance uniform float nvg : hint_range(0.0, 1.0) = 0.0;
instance uniform float seed = 0.0;
uniform vec3 base_color : source_color = vec3(0.018, 0.018, 0.021);
uniform vec3 cloth_color : source_color = vec3(0.030, 0.029, 0.027);
uniform float sheen = 0.5;
uniform float static_amount = 1.0;

varying vec3 v_obj;
varying float v_ph;
varying vec3 v_wn;

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
float vnoise2(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	float ph = hash12(UV * 917.3 + seed);
	v_ph = ph;
	float slot = floor(TIME * 20.0 + ph * 5.0);
	float n1 = hash11(slot + ph * 61.7) - 0.5;
	float n2 = hash11(slot * 1.31 + ph * 43.1 + 3.1) - 0.5;
	float n3 = hash11(slot * 0.77 + ph * 17.9 + 9.7) - 0.5;
	float spike = step(0.955, hash11(slot * 0.11 + ph * 3.3));
	float amp = shiver * COLOR.r * (0.005 + spike * 0.022);
	vec3 jdir = normalize(vec3(n2, n3, n1) + 0.001);
	VERTEX += (NORMAL * n1 * 0.8 + jdir * 0.6) * amp;
	v_obj = VERTEX;
	v_wn = normalize(mat3(MODEL_MATRIX) * NORMAL);
}

void fragment() {
	// frayed cloth edges
	if (COLOR.a < 0.98) {
		float fr = vnoise2(UV * vec2(38.0, 60.0) + seed) * 0.6 + vnoise2(UV * vec2(120.0, 200.0)) * 0.4;
		if (fr > (COLOR.a - 0.38) * 1.75) discard;
	}
	float dsv = 0.0;
	if (dissolve > 0.0) {
		float dn = fbm3(v_obj * 4.0 + seed);
		float th = dissolve * 1.15 - 0.05;
		if (dn < th) discard;
		dsv = smoothstep(th + 0.08, th, dn);
	}
	vec3 n = normalize(NORMAL);
	vec3 v = normalize(-VERTEX);
	float ndv = clamp(dot(n, v), 0.0, 1.0);
	float fres = pow(1.0 - ndv, 3.0);
	float cloth = COLOR.g;
	float grime = COLOR.b;
	vec3 col = mix(base_color, cloth_color, cloth);
	// cloth weave and grime mottling
	float mot = fbm3(v_obj * 9.0 + seed * 3.0);
	col *= 0.8 + 0.5 * mot;
	col = mix(col, vec3(0.05, 0.045, 0.038), grime * smoothstep(0.55, 0.85, mot) * 0.5);
	// oil-slick thin film at grazing angles, drifting slowly
	float film = fbm3(v_obj * 3.0 + vec3(TIME * 0.05, -TIME * 0.03, 0.0));
	vec3 slick = 0.5 + 0.5 * cos(6.2831 * (fres * 1.6 + film * 1.2 + vec3(0.0, 0.33, 0.67)));
	slick *= vec3(0.9, 0.95, 1.05);
	// TV static crawling on the rim: high frequency hash refreshed every frame, banded by drifting scanlines
	float st = hash12(floor(UV * vec2(900.0, 1400.0)) + floor(TIME * 30.0) * 0.37 + seed);
	float band = 0.6 + 0.4 * smoothstep(0.2, 1.0, sin(v_obj.y * 26.0 - TIME * 2.4 + v_ph * 3.0));
	float stat = st * st * band * static_amount * (0.35 + 0.65 * shiver) * COLOR.r;
	float rim = fres * (0.5 + 0.5 * cloth * 0.4);
	ALBEDO = col + slick * sheen * 0.10 * fres * fres + vec3(0.2, 0.21, 0.23) * stat * (0.15 + rim * 1.6);
	ALBEDO = mix(ALBEDO, vec3(0.30, 0.29, 0.28), dsv);
	EMISSION = vec3(0.55, 0.6, 0.7) * stat * rim * 0.9 * (1.0 + nvg * 3.0) + slick * 0.02 * fres * fres * fres;
	ROUGHNESS = mix(0.72, 0.9, cloth) - fres * 0.25 * (1.0 - cloth * 0.5);
	SPECULAR = 0.35 + 0.25 * (1.0 - cloth);
	METALLIC = 0.0;
	// night vision: the body stops being an absence
	ALBEDO = mix(ALBEDO, vec3(0.28, 0.31, 0.27), nvg * 0.6);
	AO = 1.0 - grime * 0.25;
	AO_LIGHT_AFFECT = 0.6;
}
