// Object 12's control building has three ground-floor windows directly below three upper-floor windows on
// its south wall. wall() used to cut only one opening per column, so the upper window's sill filled the
// lower one solid behind its own frame and glass. Fire a ray through the middle of each opening and
// through two solid piers, and report what stops.
export default async function (page, api) {
  await api.start();
  const out = await api.run(`(() => {
    const ctx = window.__radius.ctx, THREE = ctx.THREE;
    const cx = 150, cz = -60, ry = 0.12, fx0 = cx + 13, fz0 = cz + 9;
    const c = Math.cos(ry), s = Math.sin(ry);
    const FX = (u, v) => fx0 + u * c + v * s, FZ = (u, v) => fz0 - u * s + v * c;
    // the recipe puts the floor at footprint-max + 0.35 over a 14 x 10 box
    let maxH = -1e9;
    for (let u = -7; u <= 7; u += 0.5) for (let v = -5; v <= 5; v += 0.5) maxH = Math.max(maxH, ctx.world.getHeight(FX(u, v), FZ(u, v)));
    const y = maxH + 0.35, S = 3.3;
    const probe = (u, wy, label) => {
      const o = new THREE.Vector3(FX(u, 7), wy, FZ(u, 7));
      const d = new THREE.Vector3(FX(u, 0) - o.x, 0, FZ(u, 0) - o.z).normalize();
      const hit = ctx.world.raycast(o, d, 12);
      return { label, u, y: +wy.toFixed(2), hit: hit ? { d: +hit.distance.toFixed(2), surface: hit.surface } : null };
    };
    const r = [];
    for (const u of [-4, -1, 2]) r.push(probe(u, y + 1.1 + 0.65, 'ground-window'));
    for (const u of [-4, -1, 2, 5]) r.push(probe(u, y + S + 1.0 + 0.65, 'upper-window'));
    for (const u of [-5.6, 3.6]) r.push(probe(u, y + 1.75, 'solid-pier'));
    return { y: +y.toFixed(2), probes: r };
  })()`);
  console.log('WINDOW_PROBE ' + JSON.stringify(out, null, 1));
  // the south wall face sits 3 m from the ray origin; anything stopping before ~3.4 m is that wall
  const wins = out.probes.filter((p) => p.label.endsWith('-window'));
  const open = wins.filter((p) => !p.hit || p.hit.d > 3.4);
  const piers = out.probes.filter((p) => p.label === 'solid-pier');
  const solid = piers.filter((p) => p.hit && p.hit.d < 3.4);
  console.log(`SUMMARY windows-open=${open.length}/${wins.length} piers-solid=${solid.length}/${piers.length}`);
}
