class_name Mats
## Shared PBR material access. Texture sets live in res://assets/textures/<kind>/<kind>_{albedo,normal,orm,height}.{webp,png}
## (normal = OpenGL Y+, orm = R ambient occlusion / G roughness / B metallic). Materials are cached per (kind, uv, tint).
## If a set is missing (generator not run yet) a flat fallback colour is used so scenes still build.
static var _cache: Dictionary = {}
static var _missing: Dictionary = {}
const FALLBACK := {
	"concrete": Color(0.55, 0.54, 0.52), "plaster": Color(0.72, 0.68, 0.6), "brick": Color(0.5, 0.3, 0.24), "rust": Color(0.42, 0.25, 0.16),
	"painted_metal": Color(0.35, 0.42, 0.38), "gunmetal": Color(0.2, 0.21, 0.22), "wood": Color(0.45, 0.34, 0.22), "logs": Color(0.4, 0.3, 0.2),
	"birch_bark": Color(0.8, 0.78, 0.72), "pine_bark": Color(0.35, 0.25, 0.18), "fabric": Color(0.36, 0.38, 0.3), "leather": Color(0.3, 0.2, 0.13),
	"rubber": Color(0.1, 0.1, 0.1), "mud": Color(0.28, 0.22, 0.16), "gravel": Color(0.45, 0.43, 0.4), "road": Color(0.3, 0.3, 0.3), "asphalt": Color(0.28, 0.28, 0.29),
	"roof_tile": Color(0.4, 0.22, 0.16), "roof_metal": Color(0.32, 0.34, 0.33), "grass": Color(0.3, 0.36, 0.18), "dirt": Color(0.36, 0.3, 0.2), "rock": Color(0.42, 0.4, 0.37),
	"sand": Color(0.6, 0.55, 0.42), "moss": Color(0.25, 0.32, 0.15), "tarp": Color(0.28, 0.35, 0.25), "paper": Color(0.8, 0.76, 0.66), "glass": Color(0.6, 0.7, 0.72),
}
static func texture_path(kind: String, map: String) -> String:
	for ext in ["webp", "png", "jpg"]:
		var p := "res://assets/textures/%s/%s_%s.%s" % [kind, kind, map, ext]
		if ResourceLoader.exists(p): return p
	return ""
static func has_set(kind: String) -> bool: return texture_path(kind, "albedo") != ""
static func pbr(kind: String, uv: float = 1.0, tint: Color = Color.WHITE, opts: Dictionary = {}) -> StandardMaterial3D:
	var key := "%s|%.3f|%s|%s" % [kind, uv, tint.to_html(), str(opts)]
	if _cache.has(key): return _cache[key]
	var m := StandardMaterial3D.new()
	m.uv1_scale = Vector3(uv, uv, uv)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	var alb := texture_path(kind, "albedo")
	if alb != "":
		m.albedo_texture = load(alb); m.albedo_color = tint
		var nrm := texture_path(kind, "normal")
		if nrm != "": m.normal_enabled = true; m.normal_texture = load(nrm); m.normal_scale = float(opts.get("normal", 1.0))
		var orm := texture_path(kind, "orm")
		if orm != "":
			m.ao_enabled = true; m.ao_texture = load(orm); m.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED; m.ao_light_affect = 0.6
			m.roughness_texture = load(orm); m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
			m.metallic = 1.0; m.metallic_texture = load(orm); m.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_BLUE
		var h := texture_path(kind, "height")
		if h != "" and opts.get("parallax", false): m.heightmap_enabled = true; m.heightmap_texture = load(h); m.heightmap_scale = float(opts.get("parallax_scale", 3.0))
		if opts.get("triplanar", false): m.uv1_triplanar = true; m.uv1_world_triplanar = true
	else:
		if not _missing.has(kind): _missing[kind] = true; push_warning("Mats: no texture set for '%s' (run tools/gen_textures.py); using flat colour" % kind)
		m.albedo_color = FALLBACK.get(kind, Color(0.5, 0.5, 0.5)) * tint
		m.roughness = float(opts.get("roughness", 0.9)); m.metallic = float(opts.get("metallic", 0.0))
	if opts.get("cull_off", false): m.cull_mode = BaseMaterial3D.CULL_DISABLED
	if opts.get("alpha_scissor", false): m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR; m.alpha_scissor_threshold = 0.5
	_cache[key] = m
	return m
static func flat(color: Color, roughness: float = 0.8, metallic: float = 0.0, emission: Color = Color.BLACK, emission_energy: float = 0.0) -> StandardMaterial3D:
	var key := "flat|%s|%.2f|%.2f|%s|%.2f" % [color.to_html(), roughness, metallic, emission.to_html(), emission_energy]
	if _cache.has(key): return _cache[key]
	var m := StandardMaterial3D.new(); m.albedo_color = color; m.roughness = roughness; m.metallic = metallic
	if emission_energy > 0.0: m.emission_enabled = true; m.emission = emission; m.emission_energy_multiplier = emission_energy
	_cache[key] = m; return m
