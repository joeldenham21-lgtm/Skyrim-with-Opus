shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled, shadows_disabled;
// Rain on the lens: a full-screen quad (the vertex stage writes clip space directly), drawn only when the player
// looks up into the rain. Two scales of drops sit in jittered cells; a few of them run, dragging a thin trail of
// micro-droplets behind them and clearing the glass in their lane. Each drop is a little lens: it inverts and
// magnifies what is behind it, darkens at its rim, catches a highlight where the sky is brightest, and softens
// what it shows. Strength comes from the script as rain x how far up the camera is pointing.
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform float amount = 0.0;
uniform float t = 0.0;
uniform float aspect = 1.777;
uniform vec3 tint : source_color = vec3(0.86, 0.89, 0.94);

float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { return vec2(hash21(p), hash21(p + 19.7)); }

void vertex() {
	POSITION = vec4(VERTEX.xy * 2.0, 0.0, 1.0);
}

// x,y refraction offset in uv, z coverage, w rim
vec4 drops(vec2 uv, float cells, float seed, float speed, float amt) {
	vec2 cell_size = vec2(cells * aspect, cells);
	vec2 g = uv * cell_size;
	vec2 id = floor(g);
	vec2 f = fract(g) - 0.5;
	vec4 best = vec4(0.0);
	// three neighbouring rows so a running drop can reach down out of its own cell
	for (int j = 0; j < 3; j++) {
		vec2 nid = id + vec2(0.0, float(j));
		float h = hash21(nid + seed);
		if (h < 0.52 - amt * 0.20) continue;
		vec2 hp = hash22(nid + seed + 3.3);
		float run = step(0.72, hash21(nid + seed + 8.1));
		float slide = run * fract(t * speed * (0.35 + hp.x) + hp.y) * 1.85;
		vec2 pos = (hp - 0.5) * 0.62 + vec2(0.0, float(j) - slide);
		float rad = (0.09 + pow(hash21(nid + seed + 5.3), 2.4) * 0.30) * (0.75 + amt * 0.35);
		vec2 dp = (f - pos) / rad;
		dp.y *= 1.0 / (1.0 + run * 0.55);        // running drops stretch
		float r2 = dot(dp, dp);
		if (r2 > 1.0) {
			// the trail: micro-droplets left in the lane above a running drop
			if (run > 0.5 && slide > 0.05) {
				float lane = abs(f.x - pos.x) / (rad * 0.5);
				float above = (f.y - pos.y) / max(slide, 0.001);
				if (lane < 1.0 && above > 0.0 && above < 1.0) {
					float bead = hash21(floor(vec2(f.x * 40.0, (f.y + t * 0.01) * 90.0)) + nid);
					float mask = step(0.90, bead) * (1.0 - lane * lane) * (1.0 - above) * amt;
					if (mask > best.z) best = vec4(vec2(0.0), mask * 0.5, mask);
				}
			}
			continue;
		}
		float inside = 1.0 - smoothstep(0.72, 1.0, r2);
		float rim = smoothstep(0.35, 1.0, r2) * inside;
		// a drop is a lens: the image behind it is inverted and shrunk toward the drop
		vec2 refr = -(f - pos) * 1.55 / cell_size;
		float cov = inside;
		if (cov > best.z) best = vec4(refr, cov, rim);
	}
	return best;
}

void fragment() {
	vec2 uv = SCREEN_UV;
	float amt = clamp(amount, 0.0, 1.0);
	vec4 a = drops(uv, 7.0, 0.0, 0.075, amt);
	vec4 b = drops(uv + vec2(0.37, 0.11), 15.0, 11.0, 0.12, amt * 0.8);
	float cov = max(a.z, b.z);
	float rim = max(a.w, b.w);
	vec2 off = a.z >= b.z ? a.xy : b.xy;
	vec3 col = texture(screen_tex, clamp(uv + off, vec2(0.002), vec2(0.998))).rgb;
	vec3 blur = textureLod(screen_tex, clamp(uv + off, vec2(0.002), vec2(0.998)), 1.6).rgb;
	col = mix(col, blur, 0.55);
	col *= 1.0 - rim * 0.42;
	// the meniscus catches the sky: a small highlight on the upper edge of each drop
	float hi = smoothstep(0.25, 1.0, rim) * smoothstep(-0.2, 0.6, -off.y * 400.0);
	col += tint * hi * 0.10 * (0.4 + 0.6 * amt);
	ALBEDO = col;
	ALPHA = clamp(cov, 0.0, 1.0) * clamp(amt * 1.5, 0.0, 1.0) * 0.92;
}
