shader_type sky;
render_mode use_half_res_pass;
// Pechorsk sky. Single-scattering atmosphere (Rayleigh + Mie, analytic optical depth), sun disc with limb darkening
// and gauze halo, moon disc with phase and mare mottling, procedural stars, and a two-layer cloud lid: a low broken
// layer (domain-warped fBm on a flattened dome) lit through its density gradient toward the sun with silver linings,
// and a thin high veil. Clouds are rendered in the half-resolution pass; the cubemap (radiance) pass uses a cheap
// version so ambient light and reflections still see the lid. Driven by scripts/world/sky.gd.

uniform vec3 sun_dir = vec3(0.0, 0.8, -0.6);
uniform vec3 sun_color : source_color = vec3(1.0, 0.95, 0.9);
uniform float sun_energy = 1.0;          // 0 at night; scales in-scatter and the cloud light
uniform float sun_disc_energy = 24.0;    // HDR radiance of the disc itself
uniform vec3 moon_dir = vec3(0.0, -1.0, 0.0);
uniform float moon_phase = 0.4;          // 0 new, 0.5 full, 1 new
uniform float moon_energy = 1.0;         // faded out by day
uniform float night = 0.0;               // Clock.night()
uniform float coverage = 0.8;            // cloud coverage 0..1
uniform float cloud_dark = 0.1;          // storm/rain darkening of the lid
uniform float cloud_soft = 0.3;          // stratus softness of the cloud edges
uniform float haze = 0.45;               // Mie turbidity 0..1
uniform float fog_level = 0.0;           // fog weather: veils the horizon with the fog colour
uniform vec3 fog_color : source_color = vec3(0.6, 0.62, 0.65);
uniform vec2 cloud_travel = vec2(0.0);   // accumulated wind travel (dome units)
uniform float storm = 0.0;
uniform float lightning = 0.0;
uniform float bolt = 0.0;
uniform vec3 lightning_dir = vec3(0.0, 0.0, 1.0);
uniform float tide = 0.0;                // white-out
uniform float sick = 0.0;                // the Tide approaching: sky goes jaundiced
uniform vec3 art_tint : source_color = vec3(1.0);
uniform float rayleigh = 1.0;
uniform float mie = 1.0;
uniform float time = 0.0;

const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const vec3 BETA_M = vec3(2.1e-5);
const float H_R = 8000.0;
const float H_M = 1200.0;

// ---- noise ----
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
const mat2 ROT = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8));
float fbm3(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = ROT * p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }
float fbm5(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = ROT * p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }

// ---- atmosphere ----
float airmass(float c) {
	float cc = max(c, 0.0);
	float zdeg = degrees(acos(clamp(cc, 0.0, 1.0)));
	return 1.0 / (cc + 0.15 * pow(max(93.885 - zdeg, 0.5), -1.253));
}
// in-scattered light along a view ray d for a light in direction s with radiance e: single scattering with each
// species integrated against its own optical depth (Rayleigh: the blue sky and the white horizon; Mie: the haze and
// the sun's aureole). Analytic, so cheap enough for every sky pixel and for the CPU copy in sky.gd.
float mie_beta() { return BETA_M.x * (0.15 + 1.2 * haze) * mie; }
vec3 scatter(vec3 d, vec3 s, vec3 e, float am_light_scale) {
	vec3 bR = BETA_R * rayleigh;
	float bM = mie_beta();
	float am_v = airmass(d.y);
	vec3 tau_r = bR * H_R * am_v;
	float tau_m = bM * H_M * min(am_v, 12.0);
	float am_s = airmass(s.y);
	vec3 tau_s = (bR * H_R + vec3(bM * H_M)) * am_s * am_light_scale;
	// light reaches the scattering column only while the light is up; twilight decays with the depth under the horizon
	float up = smoothstep(-0.12, 0.05, s.y);
	vec3 t_s = exp(-tau_s) * up;
	float mu = dot(d, s);
	float phase_r = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
	float g = 0.76;
	float hg = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
	float phase_m = hg * 0.8 + 0.2 / (4.0 * PI);
	return e * t_s * (phase_r * (1.0 - exp(-tau_r)) + vec3(phase_m * (1.0 - exp(-tau_m)))) * 4.0 * PI;
}
vec3 sun_transmittance(vec3 s, float scale) {
	vec3 bR = BETA_R * rayleigh;
	float bM = mie_beta();
	return exp(-(bR * H_R + vec3(bM * H_M)) * airmass(s.y) * scale);
}

// ---- clouds ----
// returns rgb = lit cloud colour, a = alpha; cheap = cubemap pass
vec4 clouds(vec3 d, vec3 sun_t, vec3 amb, bool cheap) {
	float upp = max(d.y, 0.0);
	float horizon_mask = smoothstep(-0.02, 0.10, d.y);
	if (horizon_mask <= 0.0) return vec4(0.0);
	vec2 cuv = d.xz / (upp * 1.55 + 0.22);
	vec2 drift1 = cloud_travel;
	vec2 drift2 = cloud_travel * 1.6 + vec2(3.1, -1.7);
	float dens;
	float dens_sun = 0.0;
	if (cheap) {
		dens = fbm3(cuv * 1.6 + drift1) * 0.72 + fbm3(cuv * 4.4 + drift2 + 5.0) * 0.42;
	} else {
		vec2 warp = vec2(fbm3(cuv * 0.85 + drift1 * 0.6), fbm3(cuv * 0.85 + 7.3 - drift1 * 0.4)) - 0.5;
		vec2 p1 = cuv * 1.6 + warp * 0.8 + drift1;
		vec2 p2 = cuv * 4.4 + warp * 0.5 + drift2 + 5.0;
		dens = fbm5(p1) * 0.72 + fbm3(p2) * 0.42;
		vec2 sun_uv = normalize(sun_dir.xz + vec2(1e-4, 0.0)) * 0.045;
		dens_sun = fbm3(p1 + sun_uv) * 0.72 + fbm3(p2 + sun_uv * 2.5) * 0.42;
	}
	float cover = clamp(coverage + storm * 0.1, 0.0, 1.0);
	float lo = 0.70 - cover * 0.58;
	float width = 0.20 + cloud_soft * 0.28;
	float alpha = smoothstep(lo, lo + width, dens);
	// a real lid: past ~85 % coverage the layer closes, leaving density (not gaps) to carry the structure
	alpha = mix(alpha, 1.0, smoothstep(0.78, 0.97, cover));
	float thick = smoothstep(lo, lo + 0.62 * (1.0 - cover * 0.55), dens);
	thick = max(thick, smoothstep(0.85, 1.0, cover) * 0.6);
	// thin high veil: cirrus haze, mostly with the lid
	float veil = smoothstep(0.42, 0.85, fbm3(cuv * 0.7 - drift1 * 0.35 + 21.0)) * (0.08 + 0.92 * cover * cover);
	// lighting: the density gradient toward the sun lights the sun-side of every cell and shadows the lee side
	float lit = cheap ? 0.0 : clamp((dens - dens_sun) * 6.0, -1.0, 1.0);
	float mu = max(dot(d, sun_dir), 0.0);
	float sun_up = smoothstep(-0.10, 0.05, sun_dir.y);
	float low_sun = 1.0 - smoothstep(0.02, 0.32, sun_dir.y);
	vec3 direct = sun_t * sun_energy * sun_up;
	vec3 albedo = vec3(0.90, 0.915, 0.94);
	// sunlit tops and sun-facing edges; bellies see the transmitted sun and the sky, darker in rain and storm
	vec3 top = albedo * (direct * 0.85 * (0.55 + 0.45 * lit) + amb * 1.3);
	vec3 belly = albedo * (direct * 0.22 * (1.0 - cloud_dark * 0.6) + amb * 0.95) * (1.0 - cloud_dark * 0.45) * vec3(0.96, 0.975, 1.0);
	vec3 col = mix(top, belly, thick);
	col *= 1.0 + 0.16 * lit * (1.0 - thick * 0.6);
	// silver lining and the forward glow of the sun through thin cloud
	float thin = 1.0 - thick;
	col += direct * (pow(mu, 8.0) * 0.5 * thin + pow(mu, 24.0) * 0.5 * (1.0 - thick * 0.85));
	// undersides catch the low sun toward it: orange bellies under a grey lid at dusk
	col += direct * pow(mu, 2.0) * (0.06 + 0.5 * low_sun) * (0.5 + 0.5 * lit) * (1.0 - thick * 0.5);
	col += direct * pow(mu, 3.0) * 0.16 * low_sun;
	// moon on the clouds at night
	float mmu = max(dot(d, moon_dir), 0.0);
	col += vec3(0.6, 0.68, 0.85) * moon_energy * night * (0.02 + pow(mmu, 6.0) * 0.08) * (1.0 - thick * 0.6);
	float a = alpha * horizon_mask;
	// veil where there is no cloud
	vec3 veil_col = albedo * (direct * 0.35 + amb * 1.2);
	float va = veil * (1.0 - alpha) * 0.5 * smoothstep(0.0, 0.15, d.y);
	col = mix(col, veil_col, va / max(a + va, 1e-4) * (1.0 - a));
	a = a + va * (1.0 - a);
	return vec4(col, a);
}

void sky() {
	vec3 d = normalize(EYEDIR);
	vec3 s = normalize(sun_dir);
	vec3 m = normalize(moon_dir);
	vec3 sun_t = sun_transmittance(s, 0.55);   // what the cloud tops see
	vec3 sun_t_ground = sun_transmittance(s, 1.0);
	vec3 sun_rad = sun_color * sun_energy;
	// ambient sky colour for the cloud lighting: the zenith and the sky 90 degrees off the sun's azimuth
	vec3 side = normalize(vec3(-s.z, 0.0, s.x));
	vec3 amb = scatter(vec3(0.0, 0.55, 0.0), s, sun_rad, 0.5) * 0.6 + scatter(normalize(vec3(side.x, 0.10, side.z)), s, sun_rad, 0.5) * 0.4;
	amb += vec3(0.010, 0.014, 0.026) * night;
	amb = mix(amb, amb * vec3(1.1, 1.05, 0.75), sick * 0.6);

	if (AT_HALF_RES_PASS) {
		vec4 c = clouds(d, sun_t, amb, false);
		COLOR = c.rgb;
		ALPHA = c.a;
	} else {
		// clear atmosphere
		vec3 col = scatter(d, s, sun_rad, 0.5);
		// twilight: the sky keeps a cold blue-grey glow after the sun has set
		float twilight = smoothstep(-0.30, -0.02, s.y) * (1.0 - smoothstep(-0.02, 0.06, s.y));
		col += vec3(0.05, 0.065, 0.10) * twilight * (0.25 + 0.75 * max(dot(d, normalize(vec3(s.x, 0.15, s.z))), 0.0)) * (1.0 - max(d.y, 0.0) * 0.6);
		// moonlight scattering (very faint) and the night base
		col += scatter(d, m, vec3(0.62, 0.7, 0.9) * 0.012 * moon_energy, 0.5) * night;
		col += vec3(0.010, 0.014, 0.026) * night * (1.0 - max(d.y, 0.0) * 0.35);
		float sky_lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
		// stars
		float star_fade = night * (1.0 - smoothstep(0.004, 0.05, sky_lum));
		if (star_fade > 0.001 && d.y > 0.0) {
			vec2 suv = vec2(atan(d.z, d.x) * 90.0, asin(clamp(d.y, -1.0, 1.0)) * 90.0);
			vec2 cell = floor(suv);
			vec2 f = fract(suv) - 0.5;
			float h = hash21(cell);
			vec2 off = (vec2(hash21(cell + 3.7), hash21(cell + 9.1)) - 0.5) * 0.7;
			float dist = length(f - off);
			float bright = smoothstep(0.93, 1.0, h);
			float star = bright * smoothstep(0.16, 0.0, dist);
			float tw = 0.75 + 0.25 * sin(time * (2.0 + h * 3.0) + h * 40.0);
			vec3 star_col = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.92, 0.8), hash21(cell + 1.3));
			col += star_col * star * tw * 0.9 * star_fade * smoothstep(0.0, 0.25, d.y);
		}
		// clouds (from the half-res pass, or cheap for the radiance cubemap)
		vec4 cl = AT_CUBEMAP_PASS ? clouds(d, sun_t, amb, true) : HALF_RES_COLOR;
		float thin = 1.0 - cl.a;
		// the sun: disc with limb darkening; a gauze halo through the veil; the coin behind gauze under the lid
		float mu = dot(d, s);
		float ang = acos(clamp(mu, -1.0, 1.0));
		float r_sun = 0.0093;   // ~0.53 deg apparent diameter
		float disc = 1.0 - smoothstep(r_sun * 0.85, r_sun * 1.05, ang);
		float limb = 1.0 - 0.55 * pow(clamp(ang / r_sun, 0.0, 1.0), 2.0);
		float halo = pow(max(mu, 0.0), 180.0) * 0.9 + pow(max(mu, 0.0), 30.0) * 0.12 + pow(max(mu, 0.0), 8.0) * 0.02;
		float sun_up = smoothstep(-0.03, 0.03, s.y);
		vec3 disc_col = sun_color * sun_t_ground * sun_disc_energy * disc * limb;
		col += disc_col * sun_up * thin;
		col += sun_color * sun_t_ground * sun_energy * halo * sun_up * (0.3 + 0.7 * thin) * (1.0 - fog_level * 0.5);
		// a faint ice pillar above the low sun
		float low_sun = 1.0 - smoothstep(0.02, 0.25, s.y);
		vec2 sxz = normalize(s.xz + vec2(1e-5, 0.0)); vec2 dxz = normalize(d.xz + vec2(1e-5, 0.0));
		float h_ang = acos(clamp(dot(sxz, dxz), -1.0, 1.0));
		float v_off = d.y - s.y;
		float pillar = exp(-h_ang * h_ang * 900.0) * exp(-max(v_off, 0.0) * 9.0) * smoothstep(-0.02, 0.01, v_off) * low_sun * sun_up;
		col += sun_color * sun_t * sun_energy * pillar * 0.25 * (0.4 + 0.6 * thin);
		// the moon: a disc with a phase-lit sphere and mare mottling, a halo through the veil
		float mmu = dot(d, m);
		float m_ang = acos(clamp(mmu, -1.0, 1.0));
		float r_moon = 0.0115;
		if (m_ang < r_moon * 1.3 && moon_energy > 0.001) {
			vec3 mr = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
			vec3 mu_ = cross(mr, m);
			vec2 lp = vec2(dot(d, mr), dot(d, mu_)) / r_moon;
			float rr = dot(lp, lp);
			float m_disc = 1.0 - smoothstep(0.92, 1.02, sqrt(rr));
			vec3 n = vec3(lp, sqrt(max(1.0 - rr, 0.0)));
			float ph = moon_phase * 2.0 * PI;
			vec3 light_dir = vec3(sin(ph), 0.0, -cos(ph));
			float lit = clamp(dot(n, light_dir), 0.0, 1.0);
			lit = smoothstep(0.0, 0.25, lit) * 0.9 + 0.1 * lit;
			float mare = 0.75 + 0.25 * smoothstep(0.35, 0.65, vnoise(lp * 3.5 + 11.0) * 0.6 + vnoise(lp * 8.0) * 0.4);
			col += vec3(0.86, 0.88, 0.95) * moon_energy * 3.5 * m_disc * lit * mare * thin;
		}
		float m_halo = pow(max(mmu, 0.0), 160.0) * 0.5 + pow(max(mmu, 0.0), 24.0) * 0.05;
		col += vec3(0.7, 0.75, 0.9) * moon_energy * night * m_halo * (0.35 + 0.65 * thin) * 0.3;
		// composite the lid
		col = mix(col, cl.rgb, cl.a);
		// lightning: the lid lights from within toward the strike, the bolt hangs under the cloud base
		if (lightning > 0.001) {
			vec2 lxz = normalize(lightning_dir.xz + vec2(1e-5, 0.0));
			float ldot = max(dot(dxz, lxz), 0.0);
			float flash = lightning * (0.18 + 0.82 * pow(ldot, 3.0)) * (0.3 + 0.7 * cl.a) * smoothstep(-0.05, 0.2, d.y);
			col += vec3(0.8, 0.85, 1.0) * flash * 1.6;
			float l_ang = atan(dxz.y, dxz.x) - atan(lxz.y, lxz.x);
			l_ang = mod(l_ang + PI, 2.0 * PI) - PI;
			float jag = (vnoise(vec2(d.y * 30.0, lightning_dir.x * 7.0)) - 0.5) * 0.05 * (1.0 - smoothstep(0.0, 0.12, d.y));
			float b = exp(-pow((l_ang - jag) * 140.0, 2.0)) * smoothstep(0.0, 0.01, d.y) * (1.0 - smoothstep(0.09, 0.14, d.y)) * bolt;
			col += vec3(0.9, 0.92, 1.0) * b * 6.0;
		}
		// fog weather veils the horizon in the fog colour
		float fog_veil = fog_level * (1.0 - smoothstep(0.0, 0.35 + fog_level * 0.4, d.y));
		col = mix(col, fog_color, fog_veil * 0.95);
		// art direction and the Tide
		col *= art_tint;
		float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
		col = mix(col, lum * vec3(0.95, 0.88, 0.62), sick * 0.55);
		col = mix(col, vec3(1.0), tide);
		COLOR = col;
	}
}
