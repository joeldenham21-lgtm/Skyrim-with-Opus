shader_type canvas_item;
render_mode unshaded;
// RADIUS — vitals / lens pass. One full-screen composite over the rendered world (DESIGN.md §8 post chain):
// breath shake, chromatic aberration, low-health desaturation, heartbeat bleed wash, directional impact
// smears, vignette, animated film grain, hurt flash and the Tide white-out. Owned by scripts/ui/hud.gd.

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;

uniform float low_hp : hint_range(0.0, 1.0) = 0.0;     // 0 healthy .. 1 about to die
uniform float hurt : hint_range(0.0, 1.0) = 0.0;       // just took a hit
uniform float bleed : hint_range(0.0, 1.0) = 0.0;      // bleeding out
uniform float breath : hint_range(0.0, 1.0) = 0.0;     // stamina spent
uniform float pulse = 0.0;                              // heartbeat phase, seconds
uniform float pulse_rate = 1.1;                         // beats per second
uniform vec2 shake = vec2(0.0);
uniform float grain_amt : hint_range(0.0, 2.0) = 1.0;
uniform float vignette_base : hint_range(0.0, 1.0) = 0.26;
uniform float aberration : hint_range(0.0, 2.0) = 0.0;
uniform float flash : hint_range(0.0, 1.0) = 0.0;       // Tide white-out / flashbang
uniform vec3 flash_color : source_color = vec3(1.0);
uniform float aspect = 1.7777;
// impact smears: xy = unit direction on screen toward the source, z = strength 0..1, w = seed
uniform vec4 hit_a = vec4(0.0);
uniform vec4 hit_b = vec4(0.0);
uniform vec4 hit_c = vec4(0.0);
uniform vec4 hit_d = vec4(0.0);

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash12(i);
	float b = hash12(i + vec2(1.0, 0.0));
	float c = hash12(i + vec2(0.0, 1.0));
	float d = hash12(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		s += vnoise(p) * a;
		p *= 2.03;
		a *= 0.5;
	}
	return s;
}

// A torn wedge of impact spatter pushed in from the rim, aimed along hit.xy.
vec3 smear(vec3 col, vec4 hit, vec2 c, float r) {
	if (hit.z <= 0.001) {
		return col;
	}
	vec2 d = normalize(c + vec2(1e-5));
	float toward = dot(d, normalize(hit.xy + vec2(1e-5)));
	float wedge = smoothstep(0.10, 0.92, toward);
	float band = smoothstep(0.22, 1.05, r);
	float ang = atan(c.y, c.x);
	float tear = fbm(vec2(ang * 3.4 + hit.w * 17.0, r * 5.5 + hit.w * 5.0));
	float blot = smoothstep(0.34, 0.72, tear) * (0.55 + 0.45 * fbm(vec2(ang * 11.0, r * 14.0 + hit.w)));
	float m = wedge * band * hit.z * blot;
	// wet impact: darkened, red-brown, never a clean red overlay
	vec3 blood = mix(vec3(0.19, 0.035, 0.028), vec3(0.055, 0.032, 0.028), smoothstep(0.4, 1.0, tear));
	col = mix(col, col * 0.25 + blood, clamp(m * 1.25, 0.0, 0.94));
	// a thin dark rim inboard of the spatter reads as the edge of vision closing
	col *= 1.0 - wedge * band * hit.z * 0.22;
	return col;
}

void fragment() {
	vec2 uv = clamp(SCREEN_UV + shake, vec2(0.0005), vec2(0.9995));
	vec2 c = (SCREEN_UV - 0.5) * vec2(aspect, 1.0);
	float r = length(c) / 0.62;

	float beat = fract(pulse * pulse_rate);
	// double thump: lub-dub
	float hb = exp(-18.0 * beat) + 0.55 * exp(-16.0 * max(0.0, beat - 0.22));

	float ab = aberration + low_hp * 0.55 + hurt * 0.7;
	vec2 off = normalize(c + vec2(1e-5)) * ab * 0.0022 * (0.25 + r * r);
	vec3 col;
	col.r = texture(screen_tex, clamp(uv + off, vec2(0.0005), vec2(0.9995))).r;
	col.g = texture(screen_tex, uv).g;
	col.b = texture(screen_tex, clamp(uv - off, vec2(0.0005), vec2(0.9995))).b;

	// low health: the colour drains out and the shadows go cold and thick
	float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
	float drain = clamp(low_hp * 0.85, 0.0, 0.88);
	col = mix(col, vec3(lum) * vec3(0.90, 0.945, 1.02), drain);
	col = mix(col, col * col * 1.15, low_hp * 0.35);

	// bleeding: a red-brown wash breathing in from the rim with the pulse
	float edge = smoothstep(0.30, 1.05, r);
	float wash = bleed * edge * (0.30 + 0.55 * hb);
	col = mix(col, col * vec3(0.72, 0.30, 0.24) + vec3(0.055, 0.008, 0.006), clamp(wash, 0.0, 0.8));

	col = smear(col, hit_a, c, r);
	col = smear(col, hit_b, c, r);
	col = smear(col, hit_c, c, r);
	col = smear(col, hit_d, c, r);

	// vignette — always a little, more when hurt or winded
	float vig = vignette_base + low_hp * 0.30 + breath * 0.22 + bleed * 0.10 + hb * low_hp * 0.10;
	col *= 1.0 - clamp(vig, 0.0, 0.92) * smoothstep(0.42, 1.35, r);

	// hurt flash: red-brown, never pure red
	col = mix(col, vec3(0.40, 0.085, 0.055), hurt * 0.38);

	// film grain, heavier in the shadows, plus a slow vertical drift so it never reads as a static texture
	if (grain_amt > 0.001) {
		vec2 gp = SCREEN_UV * vec2(1920.0, 1080.0) * 0.75;
		float g = hash12(gp + vec2(floor(TIME * 24.0) * 71.3, floor(TIME * 24.0) * 13.7));
		float shadow_bias = 1.0 - smoothstep(0.05, 0.55, lum);
		col += (g - 0.5) * 0.055 * grain_amt * (0.45 + 0.75 * shadow_bias);
	}

	col = mix(col, flash_color, clamp(flash, 0.0, 1.0));
	COLOR = vec4(max(col, vec3(0.0)), 1.0);
}
