// Shared GLSL snippets. Import and concatenate into shader sources.
export const GLSL_NOISE = /* glsl */`
float hash11(float p){ p = fract(p*0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y); }
float vnoise3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }
float fbm3(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<3;i++){ s += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }
float fbm3d(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise3(p); p = p*2.02 + 13.7; a *= 0.5; } return s; }
// Worley (cellular) distance, 2D
float worley(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); float d = 1.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g = vec2(float(x), float(y)); vec2 o = hash22(i+g); d = min(d, length(g+o-f)); } return d; }
`;

export const GLSL_ACES = /* glsl */`
vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(12.92*c, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * Format a JS number as a valid GLSL float literal.
 *
 * Interpolating a number straight into shader source and appending ".0" only works for
 * integers: a value that already has a fractional part yields nonsense like "-0.6.0",
 * which fails to compile with "invalid number" and takes the whole material with it.
 */
export const glslFloat = (v) => {
  if (!Number.isFinite(v)) throw new Error(`glslFloat: ${v} is not a finite number`);
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};
