shader_type sky;
render_mode use_half_res_pass;
// Pechorsk sky.
//
//  * Atmosphere: analytic single scattering (Rayleigh + Mie against their own optical depths) so the horizon, the
//    zenith, the aureole around the sun and the twilight all come out of one model. scripts/world/sky.gd runs the
//    same maths on the CPU to colour the engine fog, so fog and sky always agree.
//  * Clouds: three layers projected onto flat decks at their own altitudes (real perspective: cells compress toward
//    the horizon), shaped by the offline noise atlas assets/lut/cloud_noise.png (perlin fBm + worley billows +
//    perlin-worley + erosion) with a domain warp. Each layer carries an optical depth, and its colour is
//    transmittance-lit: sun light attenuated by the depth toward the sun (so tops and sun-facing flanks are bright,
//    bellies are dark), plus sky ambient, plus a Henyey-Greenstein forward lobe for silver linings and for the
//    "coin behind gauze" glow of the sun through the lid. High coverage closes the deck without flattening it:
//    the structure then lives in the density, exactly like a real overcast.
//      veil  ~7000 m  cirrus, stretched by the wind
//      deck  ~1700 m  the lid (stratocumulus/nimbostratus): the zone's default state
//      scud  ~ 700 m  ragged low fractus under rain and storm, moving visibly faster
//  * Rain curtains hang under the deck near the horizon in rain and storm.
//  * Sun disc with limb darkening and an ice pillar at low elevation, moon disc with phase and mare, procedural
//    stars with a faint galactic band, lightning (flash + bolt), the fog veil, the Tide's whitening.

uniform vec3 sun_dir = vec3(0.0, 0.8, -0.6);
uniform vec3 sun_color : source_color = vec3(1.0, 0.95, 0.9);
uniform float sun_energy = 1.0;          // radiance above the clouds (the hour key); 0 at night
uniform float sun_disc_energy = 26.0;
uniform vec3 moon_dir = vec3(0.0, -1.0, 0.0);
uniform float moon_phase = 0.4;          // 0 new, 0.5 full, 1 new
uniform float moon_energy = 1.0;
uniform float night = 0.0;               // Clock.night()
uniform float coverage = 0.8;            // cloud cover 0..1
uniform float cloud_dark = 0.1;          // rain/storm darkening of the lid
uniform float cloud_soft = 0.3;          // stratus softness of the cloud edges
uniform float scud = 0.0;                // ragged low cloud under the deck (rain, storm)
uniform float haze = 0.45;               // Mie turbidity 0..1
uniform float fog_level = 0.0;
uniform vec3 fog_color : source_color = vec3(0.6, 0.62, 0.65);
uniform vec2 cloud_travel = vec2(0.0);   // accumulated wind travel, metres
uniform float wind_dir_x = 1.0;
uniform float wind_dir_z = 0.0;
uniform float storm = 0.0;
uniform float rain_amount = 0.0;         // distant rain curtains
uniform float lightning = 0.0;
uniform float bolt = 0.0;
uniform vec3 lightning_dir = vec3(0.0, 0.0, 1.0);
uniform float tide = 0.0;                // white-out
uniform float sick = 0.0;                // the Tide approaching: the sky goes jaundiced
uniform vec3 art_tint : source_color = vec3(1.0);
uniform float rayleigh = 1.0;
uniform float mie = 1.0;
uniform float time = 0.0;
uniform sampler2D cloud_tex : filter_linear_mipmap, repeat_enable;

const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const vec3 BETA_M = vec3(2.1e-5);
const float H_R = 8000.0;
const float H_M = 1200.0;
const vec3 CLOUD_ALBEDO = vec3(0.92, 0.935, 0.96);

// ---------------------------------------------------------------- noise
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
const mat2 ROT = mat2(vec2(0.80, 0.60), vec2(-0.60, 0.80));
// bill mixes the perlin base (0) with the worley billows (1); the alpha channel erodes the small scales
float fbm2(vec2 p, float bill) {
	vec4 a = texture(cloud_tex, p);
	vec4 b = texture(cloud_tex, ROT * p * 2.13 + vec2(0.137, 0.251));
	return (mix(a.r, a.g, bill) * 0.667 + mix(b.r, b.g, bill) * 0.333);
}
float fbm4(vec2 p, float bill) {
	float s = 0.0;
	vec4 a = texture(cloud_tex, p);                                             s += 0.533 * mix(a.r, a.g, bill);
	vec2 q = ROT * p * 2.13 + vec2(0.137, 0.251);
	vec4 b = texture(cloud_tex, q);                                             s += 0.267 * mix(b.r, b.g, bill);
	q = ROT * q * 2.07 + vec2(0.611, 0.079);
	vec4 c = texture(cloud_tex, q);                                             s += 0.133 * mix(c.b, c.a, bill);
	q = ROT * q * 2.31 + vec2(0.317, 0.733);
	vec4 e = texture(cloud_tex, q);                                             s += 0.067 * e.a;
	return s;
}

// ---------------------------------------------------------------- atmosphere
float airmass(float c) {
	float cc = max(c, 0.0);
	float zdeg = degrees(acos(clamp(cc, 0.0, 1.0)));
	return 1.0 / (cc + 0.15 * pow(max(93.885 - zdeg, 0.5), -1.253));
}
float mie_beta() { return BETA_M.x * (0.15 + 1.2 * haze) * mie; }
vec3 scatter(vec3 d, vec3 s, vec3 e, float am_light_scale) {
	vec3 bR = BETA_R * rayleigh;
	float bM = mie_beta();
	float am_v = airmass(d.y);
	vec3 tau_r = bR * H_R * am_v;
	float tau_m = bM * H_M * min(am_v, 12.0);
	vec3 tau_s = (bR * H_R + vec3(bM * H_M)) * airmass(s.y) * am_light_scale;
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
// the clear sky, without clouds or discs: used by the cloud layers for their aerial perspective
vec3 sky_base(vec3 d, vec3 s, vec3 m, vec3 sun_rad) {
	vec3 col = scatter(d, s, sun_rad, 0.5);
	float twilight = smoothstep(-0.30, -0.02, s.y) * (1.0 - smoothstep(-0.02, 0.06, s.y));
	col += vec3(0.055, 0.062, 0.095) * twilight * (0.25 + 0.75 * max(dot(d, normalize(vec3(s.x, 0.15, s.z))), 0.0)) * (1.0 - max(d.y, 0.0) * 0.6);
	col += scatter(d, m, vec3(0.62, 0.7, 0.9) * 0.014 * moon_energy, 0.5) * night;
	col += vec3(0.0085, 0.0115, 0.0215) * night * (1.0 - max(d.y, 0.0) * 0.35);
	return col;
}

// ---------------------------------------------------------------- clouds
// Cloud phase: 1.0 means "reflects the sun as a white lambertian sheet would". A baseline for the whole sky plus
// two forward lobes for the silver linings; not a normalised HG, because the sun radiance here is already the
// radiance the cloud top receives.
float cloud_phase(float mu) {
	float f = max(mu, 0.0);
	return 0.62 + 0.85 * f * f + 2.6 * pow(f, 9.0);
}

// One deck. h = altitude (m), k = horizon softener, cell = metres per noise tile, cover 0..1,
// dens_k = optical depth per unit density, bill = billow mix, warpa = domain warp strength,
// speed = wind multiplier, thin = how translucent the layer is at its edges.
vec4 cloud_layer(vec3 d, vec3 s, float h, float k, float cell, float cover, float dens_k, float bill,
		float warpa, float speed, float soft, float dark, vec3 direct, vec3 amb, vec3 haze_col, bool cheap) {
	if (cover <= 0.001) return vec4(0.0);
	float hy = d.y;
	float horizon = smoothstep(-0.004, 0.055, hy);
	if (horizon <= 0.0) return vec4(0.0);
	float scale = 1.0 / cell;
	vec2 p = d.xz * (h / (max(hy, 0.0) + k)) * scale + cloud_travel * speed * scale;
	// domain warp: the big rolls of a real deck
	vec2 w = vec2(0.0);
	if (!cheap) w = (vec2(texture(cloud_tex, p * 0.27).r, texture(cloud_tex, p * 0.27 + vec2(0.5, 0.13)).r) - 0.5) * warpa;
	float dn = cheap ? fbm2(p + w, bill) : fbm4(p + w, bill);
	float thr = mix(0.80, 0.02, cover);
	float width = 0.015 + soft * 0.22;
	float alpha = smoothstep(thr, thr + width, dn) * horizon;
	if (alpha <= 0.002) return vec4(0.0);
	float od = max(dn - thr, 0.0) * dens_k;
	// depth toward the sun: step along the sun's azimuth by the horizontal run of a ray through the layer
	vec2 sxz = normalize(s.xz + vec2(1e-5, 0.0));
	float run = clamp(0.45 / max(s.y + 0.12, 0.12), 0.4, 3.2);
	float od_s = od;
	if (!cheap) {
		float dn1 = fbm2(p + w + sxz * (0.16 * run), bill);
		float dn2 = fbm2(p + w + sxz * (0.44 * run), bill);
		od_s = (max(dn1 - thr, 0.0) * 0.65 + max(dn2 - thr, 0.0) * 0.35) * dens_k;
	}
	float mu = dot(d, s);
	float T = exp(-(od_s * 2.6 + od * 0.5));
	// multiple scattering approximation: a second, softer term that survives deep in the cloud
	float T2 = exp(-(od_s * 0.65 + od * 0.15)) * 0.32;
	float fwd = cloud_phase(mu);
	vec3 lit = direct * (T + T2) * fwd;
	vec3 ambient = amb * (0.55 + 0.75 * exp(-od * 0.85));
	vec3 col = CLOUD_ALBEDO * (lit + ambient);
	// bellies go grey-blue and dark under rain
	col *= mix(1.0, 0.42, dark * clamp(od * 0.9, 0.0, 1.0));
	// powder: thin edges toward the light darken slightly, thick sunlit flanks flare (silver linings)
	col *= 0.72 + 0.28 * (1.0 - exp(-od * 3.5));
	col += direct * pow(max(mu, 0.0), 26.0) * (0.55 * exp(-od_s * 1.6)) * (1.0 - dark * 0.6);
	// the moon picks out the cloud edges at night
	float mmu = max(dot(d, normalize(moon_dir)), 0.0);
	col += vec3(0.60, 0.66, 0.86) * moon_energy * night * (0.016 + pow(mmu, 8.0) * 0.10) * exp(-od_s * 0.9);
	// aerial perspective: the lid dissolves into the haze at the horizon
	float ap = 1.0 - smoothstep(0.0, 0.30, hy);
	col = mix(col, haze_col, ap * ap * 0.88);
	alpha = min(alpha, 1.0);
	return vec4(col, alpha);
}

void sky() {
	vec3 d = normalize(EYEDIR);
	vec3 s = normalize(sun_dir);
	vec3 m = normalize(moon_dir);
	vec3 sun_t = sun_transmittance(s, 0.55);       // what the cloud tops see
	vec3 sun_t_ground = sun_transmittance(s, 1.0);
	vec3 sun_rad = sun_color * sun_energy;
	float sun_up = smoothstep(-0.10, 0.05, s.y);
	vec3 direct = sun_t * sun_energy * sun_up * sun_color;
	// ambient the clouds sit in: the zenith and the sky 90 degrees off the sun's azimuth
	vec3 side = normalize(vec3(-s.z, 0.0, s.x));
	vec3 amb = scatter(vec3(0.0, 0.55, 0.0), s, sun_rad, 0.5) * 0.55 + scatter(normalize(vec3(side.x, 0.10, side.z)), s, sun_rad, 0.5) * 0.45;
	amb += vec3(0.010, 0.014, 0.026) * night;
	amb += vec3(0.55, 0.60, 0.75) * moon_energy * night * 0.012;
	amb = mix(amb, amb * vec3(1.1, 1.05, 0.75), sick * 0.6);

	// cloud weights per weather: the lid carries the coverage, the veil is thin and mostly follows it,
	// the scud only appears under rain and storm.
	float cov_deck = clamp(coverage, 0.0, 1.0);
	float cov_veil = clamp(0.18 + coverage * 0.45, 0.0, 0.75);
	float cov_scud = clamp(scud, 0.0, 0.85);

	if (AT_HALF_RES_PASS) {
		vec3 haze_col = sky_base(normalize(vec3(d.x, max(d.y, 0.0) * 0.35 + 0.012, d.z)), s, m, sun_rad);
		vec4 veil = cloud_layer(d, s, 7000.0, 0.28, 9000.0, cov_veil, 0.9, 0.15, 0.35, 0.55, 0.55 + cloud_soft * 0.3,
			cloud_dark * 0.25, direct, amb, haze_col, false);
		vec4 deck = cloud_layer(d, s, 1750.0, 0.105, 2600.0, cov_deck, 2.6 + storm * 1.4, 0.45 + storm * 0.2,
			0.55, 1.0, cloud_soft, cloud_dark, direct, amb, haze_col, false);
		vec4 low = cloud_layer(d, s, 700.0, 0.055, 1250.0, cov_scud, 2.2, 0.62, 0.9, 2.1, 0.30,
			cloud_dark * 1.15, direct, amb, haze_col, false);
		vec4 c = veil;
		c.rgb = mix(c.rgb, deck.rgb, deck.a); c.a = deck.a + c.a * (1.0 - deck.a);
		c.rgb = mix(c.rgb, low.rgb, low.a);   c.a = low.a + c.a * (1.0 - low.a);
		COLOR = c.rgb;
		ALPHA = c.a;
	} else {
		vec3 col = sky_base(d, s, m, sun_rad);
		float sky_lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
		// stars, with a faint galactic band
		float star_fade = night * (1.0 - smoothstep(0.004, 0.055, sky_lum));
		if (star_fade > 0.001 && d.y > 0.0) {
			vec2 suv = vec2(atan(d.z, d.x) * 90.0, asin(clamp(d.y, -1.0, 1.0)) * 90.0);
			vec2 cell = floor(suv);
			vec2 f = fract(suv) - 0.5;
			float hh = hash21(cell);
			vec2 off = (vec2(hash21(cell + 3.7), hash21(cell + 9.1)) - 0.5) * 0.7;
			float dist = length(f - off);
			float bright = smoothstep(0.925, 1.0, hh);
			float star = bright * smoothstep(0.17, 0.0, dist);
			float tw = 0.72 + 0.28 * sin(time * (2.0 + hh * 3.0) + hh * 40.0);
			vec3 star_col = mix(vec3(0.82, 0.88, 1.0), vec3(1.0, 0.9, 0.78), hash21(cell + 1.3));
			float band = exp(-pow((dot(d, normalize(vec3(0.55, 0.35, -0.75))) ) * 3.2, 2.0));
			col += star_col * star * tw * (0.85 + 1.4 * band) * star_fade * smoothstep(0.0, 0.22, d.y);
			col += vec3(0.011, 0.013, 0.020) * band * star_fade * smoothstep(0.0, 0.3, d.y);
		}
		vec4 cl;
		if (AT_CUBEMAP_PASS) {
			vec3 haze_col = sky_base(normalize(vec3(d.x, max(d.y, 0.0) * 0.35 + 0.012, d.z)), s, m, sun_rad);
			cl = cloud_layer(d, s, 1750.0, 0.105, 2600.0, cov_deck, 2.6, 0.45, 0.55, 1.0, cloud_soft, cloud_dark,
				direct, amb, haze_col, true);
		} else {
			cl = HALF_RES_COLOR;
		}
		float thin = 1.0 - cl.a;
		// the sun: a disc with limb darkening and a gauze halo
		float mu = dot(d, s);
		float ang = acos(clamp(mu, -1.0, 1.0));
		float r_sun = 0.0093;
		float disc = 1.0 - smoothstep(r_sun * 0.85, r_sun * 1.05, ang);
		float limb = 1.0 - 0.55 * pow(clamp(ang / r_sun, 0.0, 1.0), 2.0);
		float halo = pow(max(mu, 0.0), 180.0) * 0.9 + pow(max(mu, 0.0), 30.0) * 0.12 + pow(max(mu, 0.0), 8.0) * 0.02;
		float disc_up = smoothstep(-0.03, 0.03, s.y);
		col += sun_color * sun_t_ground * sun_disc_energy * disc * limb * disc_up * thin;
		col += sun_color * sun_t_ground * sun_energy * halo * disc_up * (0.25 + 0.75 * thin) * (1.0 - fog_level * 0.5);
		// an ice pillar above the low sun
		float low_sun = 1.0 - smoothstep(0.02, 0.25, s.y);
		vec2 sxz = normalize(s.xz + vec2(1e-5, 0.0)); vec2 dxz = normalize(d.xz + vec2(1e-5, 0.0));
		float h_ang = acos(clamp(dot(sxz, dxz), -1.0, 1.0));
		float v_off = d.y - s.y;
		float pillar = exp(-h_ang * h_ang * 900.0) * exp(-max(v_off, 0.0) * 9.0) * smoothstep(-0.02, 0.01, v_off) * low_sun * disc_up;
		col += sun_color * sun_t * sun_energy * pillar * 0.22 * (0.4 + 0.6 * thin);
		// the moon
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
			float mare = 0.74 + 0.26 * smoothstep(0.35, 0.65, vnoise(lp * 3.5 + 11.0) * 0.6 + vnoise(lp * 8.0) * 0.4);
			col += vec3(0.88, 0.9, 0.96) * moon_energy * 3.6 * m_disc * lit * mare * thin;
		}
		float m_halo = pow(max(mmu, 0.0), 160.0) * 0.5 + pow(max(mmu, 0.0), 22.0) * 0.06;
		col += vec3(0.7, 0.75, 0.9) * moon_energy * night * m_halo * (0.35 + 0.65 * thin) * 0.32;
		// composite the lid
		col = mix(col, cl.rgb, cl.a);
		// rain curtains: vertical smears hanging out of the deck near the horizon
		if (rain_amount > 0.01) {
			float band = smoothstep(0.20, 0.02, d.y) * smoothstep(-0.03, 0.02, d.y);
			float az = atan(d.z, d.x);
			float shafts = fbm2(vec2(az * 1.9 + cloud_travel.x * 0.0009, d.y * 2.4 + 3.0), 0.2);
			float curtain = band * rain_amount * smoothstep(0.42, 0.78, shafts) * 0.85;
			vec3 cur_col = mix(cl.rgb, fog_color, 0.35) * (0.78 - cloud_dark * 0.2);
			col = mix(col, cur_col, clamp(curtain, 0.0, 0.85));
		}
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
		float fog_veil = fog_level * (1.0 - smoothstep(0.0, 0.32 + fog_level * 0.45, d.y));
		col = mix(col, fog_color, fog_veil * 0.96);
		// art direction and the Tide
		col *= art_tint;
		float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
		col = mix(col, lum * vec3(0.95, 0.88, 0.62), sick * 0.55);
		col = mix(col, vec3(1.0), tide);
		COLOR = col;
	}
}
