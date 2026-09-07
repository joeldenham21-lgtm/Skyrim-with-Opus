shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, world_vertex_coords, shadows_disabled;
// Rain streak: each particle is a quad rebuilt in the vertex stage as a thin camera-facing ribbon aligned with the
// fall direction (gravity + wind), so drops slant with the wind and never show as flat billboards.
uniform vec3 fall_dir = vec3(0.0, -1.0, 0.0);
uniform float len = 0.45;
uniform float width = 0.012;
uniform vec3 tint : source_color = vec3(0.8, 0.85, 0.9);
uniform float alpha = 0.35;
varying vec2 v_uv;

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
}

void fragment() {
	float x = abs(v_uv.x - 0.5) * 2.0;
	float a = (1.0 - x * x) * smoothstep(0.0, 0.3, v_uv.y) * smoothstep(1.0, 0.5, v_uv.y);
	ALBEDO = tint;
	ALPHA = a * alpha;
}
