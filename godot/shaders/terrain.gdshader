shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
// RADIUS terrain: GPU-displaced chunk grids + 8-layer height-blended splat.
//
// Geometry: every chunk instance is one of four shared flat grids (1 / 2 / 4 / 8 m cells) whose local y carries a
// skirt offset (0 on the surface, negative on the border ring). vertex() looks the height up in height_tex, so LOD
// switches never move the surface and the skirts hide the cracks between neighbouring LODs.
// Shading: world-space normal from normal_tex (the 1 m heightfield normal) so every LOD lights identically; splat
// weights for grass/dirt/mud/rock/gravel/asphalt/sand/moss from splat_tex + splat2_tex + roads_tex; height-blended
// PBR from three Texture2DArray sheets; triplanar rock on steep ground; macro colour variation at 20/60/200 m to
// kill tiling; detail normal near the camera; wetness darkening, roughness drop and puddles from splat2.b + rain.

// --- data maps: 1 m grid, (N+1)^2, clamped ------------------------------------------------------------------
uniform sampler2D height_tex : filter_linear, repeat_disable;
uniform sampler2D normal_tex : filter_linear_mipmap, repeat_disable;
uniform sampler2D splat_tex : filter_linear_mipmap, repeat_disable;
uniform sampler2D splat2_tex : filter_linear_mipmap, repeat_disable;
uniform sampler2D roads_tex : filter_linear_mipmap, repeat_disable;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
// --- ground layer sheets: grass dirt mud rock gravel asphalt sand moss ---------------------------------------
uniform sampler2DArray layer_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray layer_nml : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray layer_orm : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float layer_tile[8];
uniform vec4 layer_tint[8];

uniform float map_half = 640.0;
uniform float map_texels = 1281.0;
uniform float rain : hint_range(0.0, 1.0) = 0.0;      // 0 dry .. 1 downpour (set by terrain.gd from the weather)
uniform float snow : hint_range(0.0, 1.0) = 0.0;
uniform float detail_far = 34.0;                      // detail normal fades out over this distance
uniform float macro_strength : hint_range(0.0, 1.0) = 0.75;
uniform float blend_sharpness : hint_range(0.02, 1.0) = 0.22;
uniform float triplanar_slope : hint_range(0.0, 1.0) = 0.55;
uniform float far_fade = 260.0;                       // beyond this only the macro tile is sampled

varying vec3 v_world;
varying vec2 v_map;

const float PUDDLE_ROUGH = 0.06;

vec2 map_uv(vec2 xz) { return (xz + vec2(map_half + 0.5)) / map_texels; }

void vertex() {
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float skirt = VERTEX.y;                                  // 0 on the surface, negative on the skirt ring
	float h = textureLod(height_tex, map_uv(wp.xz), 0.0).r;
	VERTEX.y = h + skirt;
	v_world = vec3(wp.x, h + skirt, wp.z);
	v_map = map_uv(wp.xz);
	NORMAL = vec3(0.0, 1.0, 0.0);
}

void fragment() {
	float dist = length(VERTEX);
	vec2 xz = v_world.xz;
	// ---- splat weights -------------------------------------------------------------------------------------
	vec4 s1 = texture(splat_tex, v_map);
	vec4 s2 = texture(splat2_tex, v_map);
	vec4 rd = texture(roads_tex, v_map);
	float w[8];
	w[0] = s1.r;                       // grass
	w[1] = s1.g * (1.0 - rd.g);        // dirt
	w[2] = s1.g * rd.g;                // mud
	w[3] = s1.b;                       // rock
	w[4] = s1.a * (1.0 - rd.r);        // gravel / ballast
	w[5] = s1.a * rd.r;                // asphalt
	w[6] = s2.r;                       // sand
	w[7] = s2.g;                       // moss
	// ---- surface normal from the heightfield --------------------------------------------------------------
	vec3 nw = normalize(texture(normal_tex, v_map).xyz * 2.0 - 1.0);
	float slope = 1.0 - nw.y;
	// rock takes over the steep faces even where the splat has not been told about it
	float steep = smoothstep(0.42, 0.80, slope);
	w[3] = max(w[3], steep * 0.75);
	float tot = 0.0;
	for (int i = 0; i < 8; i++) { w[i] = max(w[i], 0.0); tot += w[i]; }
	for (int i = 0; i < 8; i++) w[i] /= max(tot, 1e-4);

	// ---- macro variation (kills tiling): three scales of tileable noise ------------------------------------
	vec4 n200 = texture(noise_tex, xz * 0.005);
	vec4 n60 = texture(noise_tex, xz * 0.0166 + vec2(0.37, 0.11));
	vec4 n20 = texture(noise_tex, xz * 0.05 + vec2(0.71, 0.53));
	float macro = (n200.r - 0.5) * 1.15 + (n60.g - 0.5) * 0.7 + (n20.b - 0.5) * 0.35;
	float macro_hue = (n200.g - 0.5) * 1.0 + (n60.r - 0.5) * 0.55;

	// ---- height-blended layer sampling --------------------------------------------------------------------
	// every layer is sampled at two incommensurate scales, the second rotated 38 degrees, and mixed by low
	// frequency noise: the lattice of a 1-2 m tile is invisible even across a 300 m field.
	float far_mix = smoothstep(far_fade * 0.35, far_fade, dist);
	float mix2 = clamp(0.30 + 0.34 * n60.g + 0.28 * far_mix, 0.0, 0.8);
	vec2 rot = vec2(dot(xz, vec2(0.783, -0.622)), dot(xz, vec2(0.622, 0.783)));
	vec3 alb[8];
	float hgt[8];
	float best = 0.0;
	for (int i = 0; i < 8; i++) {
		alb[i] = vec3(0.0); hgt[i] = 0.0;
		if (w[i] < 0.004) continue;
		float tile = max(layer_tile[i], 0.25);
		vec2 uv = xz / tile;
		vec4 a;
		if (i == 3 && slope > triplanar_slope * 0.5) {
			// triplanar rock: the vertical faces get the side projections instead of a stretched top one
			vec3 bw = pow(abs(nw), vec3(4.0));
			bw /= max(bw.x + bw.y + bw.z, 1e-4);
			vec4 ax = texture(layer_alb, vec3(v_world.zy / tile, float(i)));
			vec4 ay = texture(layer_alb, vec3(uv, float(i)));
			vec4 az = texture(layer_alb, vec3(v_world.xy / tile, float(i)));
			a = ax * bw.x + ay * bw.y + az * bw.z;
		} else {
			a = texture(layer_alb, vec3(uv, float(i)));
		}
		vec4 b = texture(layer_alb, vec3(rot / (tile * 3.17) + vec2(0.37, 0.11), float(i)));
		a = mix(a, b, mix2);
		alb[i] = a.rgb * layer_tint[i].rgb;
		hgt[i] = a.a;
	}
	// height-aware blend: a layer wins where its own height map is high, so gravel sits in the grass instead of fading
	for (int i = 0; i < 8; i++) {
		if (w[i] < 0.004) continue;
		best = max(best, hgt[i] + w[i]);
	}
	float bw_sum = 0.0;
	float bw[8];
	for (int i = 0; i < 8; i++) {
		bw[i] = 0.0;
		if (w[i] < 0.004) continue;
		bw[i] = max(hgt[i] + w[i] - (best - blend_sharpness), 0.0);
		bw_sum += bw[i];
	}
	bw_sum = max(bw_sum, 1e-4);
	vec3 albedo = vec3(0.0);
	float rough = 0.0;
	float ao = 0.0;
	vec3 tnrm = vec3(0.0, 0.0, 1.0);
	float wet_layer = 0.0;
	float detail_amt = 1.0 - smoothstep(detail_far * 0.35, detail_far, dist);
	for (int i = 0; i < 8; i++) {
		if (bw[i] <= 0.0) continue;
		float k = bw[i] / bw_sum;
		albedo += alb[i] * k;
		float tile = max(layer_tile[i], 0.25);
		vec3 orm = texture(layer_orm, vec3(xz / tile, float(i))).rgb;
		rough += orm.g * k;
		ao += orm.r * k;
		if (detail_amt > 0.004) {
			vec3 dn = texture(layer_nml, vec3(xz / tile, float(i))).xyz * 2.0 - 1.0;
			tnrm += vec3(dn.xy * k * detail_amt * (i == 3 ? 0.45 : 1.0), 0.0);
		}
		// mud and marsh mud read wetter than the rest
		wet_layer += (i == 2 ? 1.0 : (i == 6 ? 0.25 : 0.0)) * k;
	}
	ao = mix(1.0, clamp(ao, 0.0, 1.0), 0.85);
	rough = clamp(rough, 0.04, 1.0);

	// ---- macro colour: large scale lightness and hue drift, plus dead patches ------------------------------
	float grassy = w[0] + w[7];
	albedo *= 1.0 + macro * 0.30 * macro_strength;
	albedo = mix(albedo, albedo * vec3(1.07, 1.02, 0.84), clamp(macro_hue, 0.0, 1.0) * 0.36 * grassy * macro_strength);
	albedo = mix(albedo, albedo * vec3(0.80, 0.86, 0.84), clamp(-macro_hue, 0.0, 1.0) * 0.35 * macro_strength);
	// a faint darkening in the hollows reads as damp ground even before the wet mask
	albedo *= 1.0 - 0.10 * smoothstep(0.35, 0.85, n60.b);
	// concrete works (dam crest, bridge decks, hard standings) read pale and dry, rail ballast dark and oiled
	albedo = mix(albedo, albedo * vec3(1.30, 1.30, 1.26) + vec3(0.025), rd.a);
	rough = mix(rough, 0.88, rd.a * 0.7);
	albedo = mix(albedo, albedo * vec3(0.78, 0.74, 0.71), rd.b * 0.55);

	// ---- normal ------------------------------------------------------------------------------------------
	vec3 t = normalize(vec3(1.0, 0.0, 0.0) - nw * nw.x);
	vec3 b = normalize(cross(nw, t));
	vec3 detail_n = normalize(nw + (tnrm.x * t + tnrm.y * b) * 0.55);

	// ---- wetness and puddles ------------------------------------------------------------------------------
	float wet_map = s2.b;
	float wet = clamp(max(wet_map, wet_layer * 0.55) * (0.55 + 0.65 * rain) + rain * 0.35 * (1.0 - w[5] * 0.3), 0.0, 1.0);
	wet *= 1.0 - smoothstep(0.35, 0.7, slope);
	float puddle = smoothstep(0.62, 0.92, wet) * smoothstep(0.16, 0.05, slope);
	puddle *= smoothstep(0.42, 0.72, n20.a * 0.5 + n60.b * 0.5 + rain * 0.25);
	albedo *= 1.0 - 0.42 * wet;
	rough = mix(rough, rough * 0.45, wet);
	vec3 nrm = mix(detail_n, normalize(mix(nw, vec3(0.0, 1.0, 0.0), 0.8)), puddle);
	rough = mix(rough, PUDDLE_ROUGH, puddle);
	albedo = mix(albedo, albedo * 0.55, puddle);
	// rain ripples on the puddles
	if (rain > 0.02 && puddle > 0.01) {
		vec2 rp = xz * 3.1;
		float ripple = sin(rp.x + TIME * 6.0 + texture(noise_tex, xz * 0.25).r * 12.0) * sin(rp.y * 1.3 - TIME * 5.3);
		nrm = normalize(nrm + vec3(ripple * 0.05, 0.0, ripple * 0.05) * rain * puddle);
	}
	// ---- snow (kept for the winter pass; splat2.a is zero for now) -----------------------------------------
	float sn = clamp(max(s2.a, snow) * smoothstep(0.55, 0.2, slope), 0.0, 1.0);
	albedo = mix(albedo, vec3(0.78, 0.80, 0.83), sn);
	rough = mix(rough, 0.72, sn);

	ALBEDO = albedo;
	ROUGHNESS = rough;
	METALLIC = 0.0;
	SPECULAR = mix(0.42, 0.62, wet);
	AO = ao;
	AO_LIGHT_AFFECT = 0.55;
	NORMAL = normalize((VIEW_MATRIX * vec4(nrm, 0.0)).xyz);
}
