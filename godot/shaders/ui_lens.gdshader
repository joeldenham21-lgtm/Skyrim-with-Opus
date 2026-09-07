shader_type canvas_item;
render_mode unshaded;
// RADIUS — what is on the glass in front of the eye: rain beading and running down, and blood when the
// explorer is badly hurt. One pass so the cost is a single screen read. Driven by scripts/ui/hud.gd from
// the sky's weather report and the player's condition.

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform float rain : hint_range(0.0, 1.0) = 0.0;
uniform float blood : hint_range(0.0, 1.0) = 0.0;
uniform float aspect = 1.7777;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yxz + 33.33);
	return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

// a layer of beads on a grid; returns the refraction offset in .xy and the bead mask in .z
vec3 drops(vec2 uv, float scale, float speed, float seed) {
	vec2 p = uv * scale;
	vec2 cell = floor(p);
	vec3 acc = vec3(0.0);
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 g = cell + vec2(float(x), float(y));
			vec2 rnd = hash22(g + seed);
			if (rnd.x < 0.42) {
				continue;
			}
			float fall = fract(rnd.y + TIME * speed * (0.35 + rnd.x * 0.65));
			vec2 pos = g + vec2(0.15 + rnd.x * 0.7, fall);
			float rad = (0.10 + rnd.y * 0.16);
			vec2 dv = p - pos;
			float d = length(dv * vec2(1.0, 0.82));
			float m = smoothstep(rad, rad * 0.45, d);
			acc.xy += normalize(dv + vec2(1e-5)) * m * rad;
			acc.z = max(acc.z, m);
			// the trail it leaves behind
			float trail = smoothstep(0.055, 0.0, abs(dv.x)) * smoothstep(0.0, 0.6, dv.y) * smoothstep(1.0, 0.4, dv.y);
			acc.z = max(acc.z, trail * 0.32);
		}
	}
	return acc;
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec3 src = texture(screen_tex, uv).rgb;
	if (rain < 0.001 && blood < 0.001) {
		COLOR = vec4(src, 1.0);
	} else {
		vec2 off = vec2(0.0);
		float wet = 0.0;
		if (rain > 0.001) {
			vec3 d1 = drops(vec2(uv.x * aspect, uv.y), 9.0, 0.16, 3.0);
			vec3 d2 = drops(vec2(uv.x * aspect, uv.y), 17.0, 0.28, 11.0);
			off += (d1.xy * 0.055 + d2.xy * 0.030) * rain;
			wet = clamp(d1.z + d2.z * 0.7, 0.0, 1.0) * rain;
		}
		vec3 col = texture(screen_tex, clamp(uv + off, vec2(0.001), vec2(0.999))).rgb;
		// the water is not clean glass: it dims and cools what it covers, and catches a little light
		col = mix(col, col * vec3(0.80, 0.86, 0.92), wet * 0.55);
		col += wet * 0.05;

		if (blood > 0.001) {
			vec2 bp = vec2(uv.x * aspect, uv.y);
			float n = vnoise(bp * 6.0 + 21.0) * 0.6 + vnoise(bp * 15.0 + 3.0) * 0.4;
			float rr = length((uv - 0.5) * vec2(aspect, 1.0)) / 0.62;
			float m = smoothstep(0.62, 0.86, n) * smoothstep(0.25, 1.0, rr) * blood;
			float streak = smoothstep(0.72, 0.98, vnoise(vec2(bp.x * 24.0, bp.y * 2.2 + 7.0))) * smoothstep(0.35, 1.0, rr) * blood * 0.7;
			m = clamp(m + streak, 0.0, 1.0);
			vec3 smear_col = mix(vec3(0.145, 0.024, 0.020), vec3(0.045, 0.022, 0.020), n);
			col = mix(col, col * 0.30 + smear_col, clamp(m * 0.9, 0.0, 0.92));
		}
		COLOR = vec4(col, 1.0);
	}
}
