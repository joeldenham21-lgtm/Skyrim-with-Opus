// Object 12's control building carries three ground-floor windows directly below three upper-floor ones on
// its south wall, plus a fourth upper window with nothing under it. wall() used to cut only one opening per
// column, so the two openings in a shared column filled each other in — in geometry and in collider — behind
// the frame and glass windowDress had already painted over them.
//
// Scan a ray up each column from outside and report the bands that are actually clear, so the result does not
// depend on guessing the floor height: a stacked column must show two open bands, the lone window one, a
// solid pier none.
export default async function (page, api) {
  await api.start();
  const out = await api.run(`(() => {
    const ctx = window.__radius.ctx, THREE = ctx.THREE;
    const cx = 150, cz = -60, ry = 0.12, fx0 = cx + 13, fz0 = cz + 9;
    const c = Math.cos(ry), s = Math.sin(ry);
    const FX = (u, v) => fx0 + u * c + v * s, FZ = (u, v) => fz0 - u * s + v * c;
    let maxH = -1e9;
    for (let u = -7; u <= 7; u += 0.5) for (let v = -5; v <= 5; v += 0.5) maxH = Math.max(maxH, ctx.world.getHeight(FX(u, v), FZ(u, v)));
    const y = maxH + 0.35, S = 3.3;
    const clear = (u, wy) => {
      const o = new THREE.Vector3(FX(u, 7), wy, FZ(u, 7));
      const d = new THREE.Vector3(FX(u, 0) - o.x, 0, FZ(u, 0) - o.z).normalize();
      const hit = ctx.world.raycast(o, d, 12);
      return !hit || hit.distance > 3.4;   // the south wall face sits 3 m from the ray origin
    };
    const band = (u, label) => {
      const bands = []; let run = null;
      for (let wy = y - 0.5; wy <= y + 2 * S + 0.6; wy += 0.05) {
        if (clear(u, wy)) { if (!run) run = [wy, wy]; else run[1] = wy; }
        else if (run) { bands.push([+run[0].toFixed(2), +run[1].toFixed(2)]); run = null; }
      }
      if (run) bands.push([+run[0].toFixed(2), +run[1].toFixed(2)]);
      return { u, label, openBands: bands };
    };
    const r = [];
    for (const u of [-4, -1, 2]) r.push(band(u, 'stacked'));
    r.push(band(5, 'lone'));
    for (const u of [-5.6, 3.6]) r.push(band(u, 'pier'));
    return {
      floorY: +y.toFixed(2),
      expectGround: [+(y + 1.1).toFixed(2), +(y + 2.4).toFixed(2)],
      expectUpper: [+(y + S + 1.0).toFixed(2), +(y + S + 2.3).toFixed(2)],
      probes: r,
    };
  })()`);
  console.log('WINDOW_PROBE ' + JSON.stringify(out));
  const cols = out.probes.filter((p) => p.label === 'stacked');
  const two = cols.filter((p) => p.openBands.length === 2);
  const lone = out.probes.find((p) => p.label === 'lone');
  const piers = out.probes.filter((p) => p.label === 'pier');
  const solid = piers.filter((p) => !p.openBands.length);
  console.log(`SUMMARY stacked-columns-open-twice=${two.length}/${cols.length} lone-window-bands=${lone ? lone.openBands.length : '?'} piers-solid=${solid.length}/${piers.length}`);
}
