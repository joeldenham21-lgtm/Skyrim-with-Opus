shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;
// Splash ring on the ground: a bright impact dot that becomes an expanding, fading ring over the particle lifetime.
uniform vec3 tint : source_color = vec3(0.8, 0.85, 0.9);
uniform float alpha = 0.5;
varying float v_phase;
varying vec2 v_uv;

void vertex() {
	v_phase = INSTANCE_CUSTOM.y;
	v_uv = UV;
}

void fragment() {
	vec2 p = (v_uv - 0.5) * 2.0;
	float r = length(p);
	float ring_r = 0.12 + v_phase * 0.85;
	float ring = exp(-pow((r - ring_r) * 10.0, 2.0));
	float impact = exp(-r * r * 30.0) * (1.0 - smoothstep(0.0, 0.3, v_phase));
	float a = (ring * (1.0 - v_phase) * 0.75 + impact) * alpha;
	ALBEDO = tint;
	ALPHA = a;
}
