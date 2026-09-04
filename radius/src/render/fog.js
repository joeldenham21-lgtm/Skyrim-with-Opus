// Global atmospheric fog. Patches three's fog chunks so EVERY material (built-in or #include-ing the
// chunks) gets height fog + distance fog + sun-scatter tint. Shared uniforms are injected through
// Material.prototype.onBeforeCompile so a single object updates all programs.
import * as THREE from 'three';

export const fogUniforms = {
  uFogSun: { value: new THREE.Vector3(0, 1, 0) },        // sun direction (toward the sun)
  uFogSunColor: { value: new THREE.Color(0.9, 0.8, 0.7) },  // scatter tint near the sun
  uFogZenith: { value: new THREE.Color(0.4, 0.45, 0.5) },   // fog color when looking up-ish
  uFogHeight: { value: new THREE.Vector4(0.06, -2.0, 1.6, 0.0) }, // falloff, base height, ground fog density multiplier, unused
};

export function installFog() {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vec4 fogWorld4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogWorld4 = instanceMatrix * fogWorld4;
  #endif
  vFogWorldPos = (modelMatrix * fogWorld4).xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogDensity;   // base exp2 density
  uniform vec3 uFogSun;
  uniform vec3 uFogSunColor;
  uniform vec3 uFogZenith;
  uniform vec4 uFogHeight;
  varying vec3 vFogWorldPos;
  vec3 radiusFog(vec3 col) {
    vec3 rel = vFogWorldPos - cameraPosition;
    float dist = length(rel);
    vec3 dir = rel / max(dist, 1e-4);
    // distance fog (exp2)
    float d = dist * fogDensity;
    float f = 1.0 - exp(-d * d);
    // height fog: denser near the ground, integrated along the ray
    float falloff = uFogHeight.x;
    float base = uFogHeight.y;
    float hf = uFogHeight.z * fogDensity * 0.7;
    float h0 = cameraPosition.y - base;
    float dy = rel.y;
    float integral = abs(dy) > 0.01 ? (exp(-falloff * h0) - exp(-falloff * (h0 + dy))) / (falloff * dy) : exp(-falloff * h0);
    float hfog = 1.0 - exp(-hf * dist * max(integral, 0.0));
    f = 1.0 - (1.0 - f) * (1.0 - clamp(hfog, 0.0, 0.95));
    // scatter tint toward the sun, horizon vs zenith
    float sunAmt = pow(max(dot(dir, uFogSun), 0.0), 6.0);
    float up = clamp(dir.y * 2.0 + 0.2, 0.0, 1.0);
    vec3 fc = mix(fogColor, uFogZenith, up * 0.5);
    fc += uFogSunColor * sunAmt * 0.6;
    return mix(col, fc, clamp(f, 0.0, 1.0));
  }
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = radiusFog(gl_FragColor.rgb);
#endif`;

  const prev = THREE.Material.prototype.onBeforeCompile;
  THREE.Material.prototype.onBeforeCompile = function (shader, renderer) {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(this, shader, renderer);
  };
}

// For custom ShaderMaterials that want fog: merge these uniforms and #include the chunks.
export function withFog(uniforms) { return Object.assign(uniforms, fogUniforms); }
