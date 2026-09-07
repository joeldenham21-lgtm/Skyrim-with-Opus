shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, world_vertex_coords, shadows_disabled;
// Rain streak. Each particle quad is rebuilt in the vertex stage as a thin camera-facing ribbon aligned with the
// fall direction (gravity + wind), so drops slant with the wind and never read as flat billboards. The streak is a
// water cylinder: it refracts what is behind it (the image flips across the streak and compresses) and carries a
// bright specular line down one side. That is what makes rain visible against a flat grey overcast, where a plain
// pale streak would disappear.
uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform vec3 fall_dir = vec3(0.0, -1.0, 0.0);
uniform float len = 0.45;
uniform float width = 0.012;
uniform vec3 tint : source_color = vec3(0.82, 0.86, 0.92);
uniform float alpha = 0.35;
uniform float bright = 1.0;      // how much specular the sky puts on the drops (day vs night)
varying vec2 v_uv;
varying float v_dist;

void vertex() {
	vec3 c = MODEL_MATRIX[3].xyz;
	float s = length(MODEL_MATRIX[0].xyz);
	vec3 to_cam = CAMERA_POSITION_WORLD - c;
	float dist = length(to_cam);
	to_cam /= max(dist, 1e-4);
	vec3 f = normalize(fall_dir);
	vec3 right = normalize(cross(to_cam, f));
	float w = width * s * max(1.0, dist * 0.09);
	VERTEX = c + right * (UV.x - 0.5) * w + f * (0.5 - UV.y) * len * s;
	v_uv = UV;
	v_dist = dist;
}

void fragment() {
	float x = (v_uv.x - 0.5) * 2.0;
	float body = 1.0 - x * x;
	float a = body * smoothstep(0.0, 0.22, v_uv.y) * smoothstep(1.0, 0.6, v_uv.y);
	// the cylinder of water flips and squeezes the scene across the streak
	vec2 off = vec2(-x * 0.006 * body, 0.0);
	vec3 bg = texture(screen_tex, clamp(SCREEN_UV + off, vec2(0.002), vec2(0.998))).rgb;
	float spec = exp(-pow((x + 0.35) * 2.6, 2.0));
	vec3 col = bg * (0.90 + 0.22 * spec) + tint * spec * 0.55 * bright;
	ALBEDO = col;
	ALPHA = clamp(a * alpha, 0.0, 1.0);
}
