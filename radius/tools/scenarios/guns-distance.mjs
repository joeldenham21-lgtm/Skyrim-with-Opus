// Does distance actually change the SOUND, or only the volume? Renders the same rifle report at a range of
// distances through the engine's real positional path (PannerNode, inverse distance, reverb send) and reports
// what reaches the bus. A gunshot 300 m away should not be a close gunshot turned down: air absorption should
// have taken the top off it, the bullet's crack should be gone (you are not inside its Mach cone), the action
// should be inaudible, and the tail should be most of what is left.
//
//   node tools/smoke.mjs --audio --scenario tools/scenarios/guns-distance.mjs --out .smoke/guns-dist --w 320 --h 180
import { DSP, OFFLINE } from './guns-lib.mjs';

const DISTS = [1.5, 25, 60, 120, 250, 450];
const GUNS = ['shot_akm', 'shot_ak74m', 'shot_pm'];

export default async function (page, api) {
  const res = await api.run(`(async () => {
    const DISTS = ${JSON.stringify(DISTS)}, GUNS = ${JSON.stringify(GUNS)}, SLOT = 2.2;
    const jobs = [];
    for (const n of GUNS) for (const d of DISTS) jobs.push({ name: n, d });
    jobs.push({ name: 'distant_shot', d: 400 });
    const TOTAL = 0.5 + jobs.length * SLOT + 1;
    ${OFFLINE}
    ${DSP}
    a.listenerPos.set(0, 1.7, 0);
    fakeNow = 0.25;
    for (const j of jobs) {
      j.t0 = fakeNow;
      a.play(j.name, { gain: 1, pos: { x: 0, y: 1.7, z: -j.d }, max: 2000, ref: 4, rolloff: 0.6 });
      fakeNow += SLOT;
    }
    const buf = await ac.startRendering();
    const d = buf.getChannelData(0);
    for (const j of jobs) {
      const m = analyse(d, Math.floor(j.t0 * SR), Math.floor((j.t0 + SLOT) * SR), SR);
      j.peak = m.peak; j.cent = m.cent; j.slew = m.slew; j.dec20 = m.dec20; j.dec60 = m.dec60;
      j.bands = m.bands; j.silent = !!m.silent;
      delete j.t0;
    }
    return { jobs };
  })()`);
  const w = (s, n) => String(s).padEnd(n);
  console.log('one rifle, several ranges (engine panner in the path)');
  for (const j of res.jobs) {
    if (j.silent) { console.log(w(j.name, 14) + w(j.d + ' m', 8) + 'SILENT (culled)'); continue; }
    console.log(w(j.name, 14) + w(j.d + ' m', 8) + ' peak ' + w(j.peak, 7)
      + ' slew ' + w(j.slew, 7) + ' decay20/60 ' + w(j.dec20, 7) + w(j.dec60, 8)
      + ' centroid ' + w(j.cent.join('/'), 26) + ' HF>3.5k ' + (j.bands[4] + j.bands[5]).toFixed(3));
  }
}
