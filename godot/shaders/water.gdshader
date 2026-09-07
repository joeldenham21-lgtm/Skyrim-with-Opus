shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back, specular_schlick_ggx, diffuse_lambert;
// RADIUS water: river, marsh, lake, quarry and reservoir surfaces built by water.gd from assets/terrain/water.png
// (mask / flow / depth) and water.f32 (per-sample surface height).
//
// Per-body character comes in through the vertex colour: COLOR.r tannin (peat-dark marsh water), COLOR.g flow
// strength, COLOR.b clarity. Shading: two-phase flow-map scrolling normals (so the river's normals travel with the
// current), a slow swell in the vertex stage, depth-fade + extinction toward the body colour, screen-space
// refraction of what is under the surface, Fresnel-weighted sky reflection at low roughness, shoreline and
// obstacle foam from the depth buffer, rain rings when it is raining.

uniform sampler2D depth_tex : hint_depth_texture, filter_linear;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform sampler2D flow_tex : filter_linear, repeat_disable;        // water.png  R mask, GB flow, A depth/16
uniform sampler2D normal_tex : filter_linear_mipmap, repeat_enable;  // water_normal.png (RGB normal, A foam)
uniform sampler2D ripple_tex : filter_linear_mipmap, repeat_enable;  // water_ripple.png (two phase packs)
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;

uniform float map_half = 640.0;
uniform float map_texels = 1281.0;
uniform float rain : hint_range(0.0, 1.0) = 0.0;
uniform float wind : hint_range(0.0, 2.0) = 0.5;
uniform float tile_a = 7.0;         // metres per tile, coarse ripple band
uniform float tile_b = 2.3;         // metres per tile, fine band
uniform float flow_speed = 0.09;    // flow-map cycle length scale
uniform float normal_strength = 0.55;
uniform float absorb = 0.42;        // extinction per metre of depth
uniform float refract_amount = 0.055;
uniform float foam_width = 0.85;    // metres of depth over which shoreline foam fades out
uniform vec3 deep_marsh : source_color = vec3(0.048, 0.058, 0.040);
uniform vec3 deep_lake : source_color = vec3(0.030, 0.052, 0.058);
uniform vec3 deep_quarry : source_color = vec3(0.036, 0.070, 0.078);
uniform vec3 shallow_tint : source_color = vec3(0.42, 0.44, 0.32);
uniform vec3 foam_color : source_color = vec3(0.62, 0.63, 0.60);
uniform float swell = 0.05;

varying vec3 v_world;
varying vec3 v_body;      // r tannin, g flow strength, b clarity

vec2 map_uv(vec2 xz) { return (xz + vec2(map_half + 0.5)) / map_texels; }

void vertex() {
	v_body = COLOR.rgb;
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	// a slow swell: two long, low waves plus a shorter one, all scaled down on sheltered marsh water
	float amp = swell * (0.35 + 0.9 * v_body.b) * (0.5 + 0.9 * wind);
	float t = TIME;
	float w1 = sin(dot(wp.xz, vec2(0.071, 0.043)) * 6.2831 + t * 0.55);
	float w2 = sin(dot(wp.xz, vec2(-0.037, 0.089)) * 6.2831 + t * 0.41);
	float w3 = sin(dot(wp.xz, vec2(0.181, -0.121)) * 6.2831 + t * 1.10);
	VERTEX.y += amp * (w1 * 0.55 + w2 * 0.35 + w3 * 0.18);
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	NORMAL = vec3(0.0, 1.0, 0.0);
}

vec3 sample_ripples(vec2 xz, vec2 flow, float scale, float phase_off) {
	// two-phase flow map: the texture is re-seeded every cycle and the two halves are cross-faded
	float ph = fract(TIME * flow_speed + phase_off);
	float ph2 = fract(ph + 0.5);
	vec2 uv = xz / scale;
	vec3 n0 = texture(normal_tex, uv - flow * ph * (8.0 / scale)).xyz * 2.0 - 1.0;
	vec3 n1 = texture(normal_tex, uv - flow * ph2 * (8.0 / scale) + vec2(0.37, 0.61)).xyz * 2.0 - 1.0;
	float k = abs(0.5 - ph) * 2.0;
	return mix(n0, n1, k);
}

void fragment() {
	vec2 uvm = map_uv(v_world.xz);
	vec4 wd = texture(flow_tex, uvm);
	vec2 flow = (wd.gb - vec2(0.5)) * 4.0;                    // m/s
	float flow_len = length(flow);
	float depth_data = wd.a * 16.0;                            // metres of water at this point

	// ---- surface normal: two bands, the coarse one carried by the flow ------------------------------------
	vec3 na = sample_ripples(v_world.xz, flow * 0.35, tile_a, 0.0);
	vec3 nb = sample_ripples(v_world.xz + vec2(13.7, 5.1), flow * 0.55, tile_b, 0.37);
	vec2 nxy = na.xy * 1.0 + nb.xy * 0.55;
	nxy *= normal_strength * (0.55 + 0.75 * wind + 0.9 * min(flow_len, 1.2));
	// rain rings
	if (rain > 0.01) {
		float rp = fract(TIME * 1.7);
		vec4 rr = texture(ripple_tex, v_world.xz * 0.55);
		vec2 r0 = rr.rg * 2.0 - 1.0;
		vec2 r1 = rr.ba * 2.0 - 1.0;
		nxy += mix(r0, r1, abs(0.5 - rp) * 2.0) * rain * 1.35;
	}
	vec3 nw = normalize(vec3(nxy.x, 1.0, nxy.y));

	// ---- scene depth behind the surface -------------------------------------------------------------------
	vec2 suv = SCREEN_UV;
	float frag_dist = -VERTEX.z;
	vec2 roff = nw.xz * refract_amount * clamp(6.0 / max(frag_dist, 1.0), 0.06, 1.0);
	vec2 ruv = clamp(suv + roff, vec2(0.001), vec2(0.999));
	float raw = texture(depth_tex, ruv).r;
	vec4 vp = INV_PROJECTION_MATRIX * vec4(vec3(ruv * 2.0 - 1.0, raw), 1.0);
	float scene_dist = -(vp.z / vp.w);
	if (scene_dist < frag_dist) {                              // the refraction grabbed something in front: undo it
		ruv = suv;
		raw = texture(depth_tex, ruv).r;
		vp = INV_PROJECTION_MATRIX * vec4(vec3(ruv * 2.0 - 1.0, raw), 1.0);
		scene_dist = -(vp.z / vp.w);
	}
	float dz = max(scene_dist - frag_dist, 0.0);               // metres of water along the view ray
	vec3 behind = textureLod(screen_tex, ruv, clamp(dz * 0.35, 0.0, 3.0)).rgb;

	// ---- body colour and extinction -----------------------------------------------------------------------
	vec3 deep = mix(mix(deep_lake, deep_quarry, clamp(v_body.b * 1.4 - 0.3, 0.0, 1.0)), deep_marsh, v_body.r);
	float path = max(dz, depth_data * 0.35);
	float ext = 1.0 - exp(-path * absorb * (0.6 + 0.9 * v_body.r));
	vec3 tint = mix(shallow_tint, vec3(0.55, 0.48, 0.32), v_body.r);
	vec3 col = mix(behind * mix(vec3(1.0), tint, clamp(path * 0.35, 0.0, 0.85)), deep, ext);

	// ---- foam: shorelines, obstacles, fast flow, wind chop -------------------------------------------------
	float shore = 1.0 - smoothstep(0.0, foam_width, dz);
	float edge_mask = 1.0 - smoothstep(0.0, 0.55, depth_data);
	vec2 fuv = v_world.xz * 0.22 - flow * TIME * 0.06;
	float fnoise = texture(noise_tex, fuv).r * 0.6 + texture(noise_tex, fuv * 2.7 + vec2(0.3)).g * 0.4;
	float foam = smoothstep(0.35, 0.85, shore * (0.55 + 0.75 * fnoise));
	foam += smoothstep(0.55, 0.95, max(edge_mask, 0.0) * fnoise) * 0.45;
	foam += smoothstep(0.7, 1.5, flow_len) * smoothstep(0.4, 0.85, fnoise) * 0.7;
	foam = clamp(foam, 0.0, 1.0) * (1.0 - 0.35 * v_body.r);
	col = mix(col, foam_color, foam * 0.85);

	// ---- output --------------------------------------------------------------------------------------------
	ALBEDO = col;
	ALPHA = clamp(max(ext * 1.25, 0.25) + foam * 0.8, 0.0, 1.0);
	ROUGHNESS = mix(0.03, 0.28, clamp(foam + rain * 0.25 + flow_len * 0.12, 0.0, 1.0));
	METALLIC = 0.0;
	SPECULAR = 0.62;
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
}
