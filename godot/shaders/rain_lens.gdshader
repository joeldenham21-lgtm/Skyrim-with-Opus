shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled, shadows_disabled;
// Rain on the lens: a full-screen quad (vertex stage writes clip space directly). Sparse small droplets in two grids
// of cells; each drop refracts the scene through its curvature (inverted, as a real lens does), shows a rim and a
// highlight, then slides off; heavy rain adds thin running streaks. Strength from the script: rain x looking up.
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform float amount = 0.0;
uniform float t = 0.0;
uniform float aspect = 1.777;

float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void vertex() {
	POSITION = vec4(VERTEX.xy * 2.0, 0.0, 1.0);
}

// one droplet layer: xy = refraction offset, z = coverage, w = rim
vec4 drops(vec2 uv, float cells, float seed, float speed) {
	vec2 g = uv * vec2(cells * aspect, cells);
	vec2 id = floor(g);
	vec2 f = fract(g) - 0.5;
	float h = hash21(id + seed);
	float life = fract(t * speed * (0.5 + h) + h * 7.0);
	float alive = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.7, 1.0, life));
	float present = step(0.86 - amount * 0.22, h);
	vec2 pos = (vec2(hash21(id + seed + 1.7), hash21(id + seed + 3.1)) - 0.5) * 0.55;
	pos.y -= smoothstep(0.45, 1.0, life) * 1.2 * (0.3 + h);
	float size = 0.05 + hash21(id + seed + 5.3) * 0.09;
	vec2 dp = (f - pos) / size;
	dp.x *= 0.85;   // drops sag a little
	float r2 = dot(dp, dp);
	float inside = 1.0 - smoothstep(0.8, 1.0, r2);
	float rim = smoothstep(0.45, 1.0, r2) * inside;
	// the lens: the scene through a drop is inverted and squeezed
	vec2 refr = -dp * (0.045 + 0.02 * (1.0 - r2)) * size * 8.0;
	float v = inside * alive * present;
	return vec4(refr * v, v, rim * v);
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec4 a = drops(uv, 9.0, 0.0, 0.04);
	vec4 b = drops(uv + vec2(0.31, 0.17), 17.0, 11.0, 0.07);
	float cov = max(a.z, b.z);
	float rim = max(a.w, b.w);
	vec2 off = a.xy + b.xy * (1.0 - a.z);
	// thin running streaks in heavy rain
	float streak = 0.0;
	if (amount > 0.5) {
		vec2 su = vec2(uv.x * 60.0 * aspect + uv.y * 2.0, uv.y);
		float col_id = floor(su.x);
		float hs = hash21(vec2(col_id, 2.0));
		float head = fract(t * (0.2 + hs * 0.35) + hs * 5.0);
		float y = fract(su.y * 0.5 - head);
		float tail = smoothstep(0.0, 0.3, y) * (1.0 - smoothstep(0.3, 0.34, y));
		float lane = 1.0 - smoothstep(0.03, 0.07, abs(fract(su.x) - 0.5));
		streak = tail * lane * step(0.8, hs) * (amount - 0.5) * 2.0;
		off += vec2(0.0, -0.008) * streak;
	}
	float mask = clamp(cov + streak, 0.0, 1.0);
	vec3 col = texture(screen_tex, clamp(uv + off, vec2(0.001), vec2(0.999))).rgb;
	// darker rim, a small highlight toward the top-left of each drop
	col *= 1.0 - rim * 0.35;
	col += vec3(0.08) * rim * smoothstep(0.3, 1.0, -(a.x + b.x) * 6.0 + (a.y + b.y) * 6.0);
	ALBEDO = col;
	ALPHA = mask * clamp(amount * 1.4, 0.0, 1.0);
}
