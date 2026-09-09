// Dimension check for every weapon, magazine and attachment, without a browser:
//
//   node tools/scenarios/weapons-measure.mjs            # every gun: length, height, width, triangles, meshes
//   node tools/scenarios/weapons-measure.mjs akm mosin  # just these
//
// Silhouette is the first thing a model gets wrong, and a bounding box catches it in a second where a screenshot
// takes a minute. REAL below is the published overall length in millimetres, so a regression shows up as a number.
// Run as a smoke scenario as well (--scenario) to measure the same thing inside the page.
import * as THREE from 'three';
import { buildGun, BUILD_IDS } from '../../src/weapons/gunmesh.js';

// Published overall length (mm), stock extended, with the standard muzzle device. A pistol's published figure is
// slide-rear to muzzle, while the bounding box also takes in the backstrap, so pistols read ~25 mm over and that is
// correct; every shoulder weapon should land within a few percent.
const REAL = {
  pm: 161, pb: 310, aps: 225, tt: 194, glock: 204, m9: 217, m1911: 210,
  kedr: 530, bizon: 690, vityaz: 705, mp5: 680, ppsh: 843,
  akm: 880, akms: 920, ak74m: 943, aks74u: 735, ak105: 824, ak12: 940, sks: 1020,
  m4: 840, hk416: 880, scar: 890, vss: 894, val: 875, sr3m: 640,
  toz: 1150, mp153: 1300, rem870: 1060, saiga: 910,
  mosin: 1232, obrez: 500, svd: 1225, sv98: 1200, rpk74: 1060, pkm: 1192,
};

export function measure(ids = BUILD_IDS) {
  const box = new THREE.Box3(), v = new THREE.Vector3(), rows = [];
  for (const id of ids) {
    const g = buildGun(id);
    g.updateMatrixWorld(true);
    box.setFromObject(g); box.getSize(v);
    let tris = 0, meshes = 0;
    g.traverse((o) => { if (o.isMesh) { meshes++; const ix = o.geometry.index; tris += (ix ? ix.count : o.geometry.attributes.position.count) / 3; } });
    rows.push({ id, len: Math.round(v.z * 1000), h: Math.round(v.y * 1000), w: Math.round(v.x * 1000), real: REAL[id] || null, tris, meshes });
  }
  return rows;
}
function print(rows) {
  for (const r of rows) {
    const err = r.real ? `${(((r.len - r.real) / r.real) * 100).toFixed(0).padStart(4)}%` : '    -';
    console.log(`${r.id.padEnd(8)} L=${String(r.len).padStart(5)}mm real=${String(r.real ?? '-').padStart(5)} ${err}  H=${String(r.h).padStart(3)} W=${String(r.w).padStart(3)}  tris=${String(r.tris).padStart(5)} meshes=${String(r.meshes).padStart(3)}`);
  }
}
export default async function (page, api) {
  await api.start();
  const rows = await api.run(`(() => { const T = window.__radius.ctx.THREE, box = new T.Box3(), v = new T.Vector3();
    return window.__gunmesh.BUILD_IDS.map((id) => { const g = window.__gunmesh.buildGun(id); g.updateMatrixWorld(true); box.setFromObject(g); box.getSize(v);
      let tris = 0, meshes = 0; g.traverse((o) => { if (o.isMesh) { meshes++; const ix = o.geometry.index; tris += (ix ? ix.count : o.geometry.attributes.position.count) / 3; } });
      return { id, len: Math.round(v.z * 1000), h: Math.round(v.y * 1000), w: Math.round(v.x * 1000), tris, meshes }; }); })()`);
  for (const r of rows) r.real = REAL[r.id] || null;
  print(rows);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2);
  print(measure(args.length ? args : BUILD_IDS));
}
