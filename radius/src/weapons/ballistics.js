// STUB — owned by the weapons agent. Hitscan shared by player weapons and (optionally) mimics.
import * as THREE from 'three';
export function createBallistics(ctx) {
  return {
    isStub: true,
    // shoot(origin, dir, { damage, range, spreadDeg, pellets, tracer, source:'player'|'enemy' }) -> [{ kind:'enemy'|'world'|'none', point, enemy?, surface? }]
    shoot(origin, dir, opts = {}) { return []; },
    update(dt) {},
  };
}
