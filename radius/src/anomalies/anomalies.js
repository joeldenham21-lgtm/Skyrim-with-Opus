// STUB — owned by the anomalies agent. Electric / reflector / gravity / gas anomalies with reveal + damage + screen effects.
export function createAnomalies(ctx) {
  const list = [];
  return {
    list,
    spawn(type, position) { return null; },
    // { strength 0..1, sx, sy (screen uv of the strongest nearby anomaly), aberration } used for post distortion
    fieldAt(pos) { return { strength: 0, sx: 0.5, sy: 0.5, aberration: 0 }; },
    nearestDistance(pos) { return Infinity; },
    populate() {}, reset() {}, update(dt) {},
  };
}
