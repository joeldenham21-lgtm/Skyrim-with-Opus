// Missions: UNPSC contracts generated from templates (RETRIEVAL / SURVEY / CLEARANCE / ARTIFACT) plus a
// scripted chain per security level that pushes north toward the Column. Records are plain JSON in
// state.data.missions = { active, completed, available, chainStep, gen }; world objects (a recorder on a
// shelf, survey stakes, planted beacons) are rebuilt from that data on every gameStart and Tide.
import * as THREE from 'three';
import { ITEMS } from '../player/inventory.js';
import { clamp } from '../core/math.js';
import { rankFor, RANKS } from '../data/index.js';
import { glowTexture } from '../render/textures.js';
import { paint, place, merge, bodyMaterial, ledMaterial } from './loot.js';

const MAX_ACTIVE = 2;
const COLS = 'ABCDEFGHIJKLMNOP';
// map square: 40 m cells, rows 1..16 south→north reading order (row 1 is the northern edge), columns A..P west→east
export const square = (x, z) => `${clamp(Math.floor((z + 320) / 40), 0, 15) + 1}-${COLS[clamp(Math.floor((x + 320) / 40), 0, 15)]}`;
const money = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// a template may list candidate item ids in order of preference; the first one the inventory knows is used
// (so 'guardlog' / 'manifest' / 'relay' take over from the shared ids the moment ITEMS carries them)
const resolveItem = (ids) => (Array.isArray(ids) ? ids.find((id) => ITEMS[id]) || ids[ids.length - 1] : ids);
const ENEMY_NAMES = { mimic: 'Mimic', slider: 'Slider', fragment: 'Fragment', spawn: 'Spawn', seeker: 'Seeker' };
const ART_NAMES = { art_pearl: 'Pearl', art_ember: 'Ember', art_tear: 'Tear', art_crown: 'Crown' };

// ---------------------------------------------------------------------------------------------
// templates. base pay is scaled by distance from Vanno and by the tide level at generation time.
// ---------------------------------------------------------------------------------------------
const TEMPLATES = [
  // RETRIEVAL — a named object at a POI
  { code: 'PSC-0417', type: 'RETRIEVAL', place: 'OBJECT 12', poi: 'object12', level: 1, base: 900, item: 'recorder', itemName: 'Data recorder', prompt: 'PICK UP · DATA RECORDER', mesh: 'recorder', where: 'the substation control room', spotKind: 'shelf', fallback: [154, -54],
    body: 'Recover the data recorder from the substation control room.', entities: '2 (class Mimic)', note: 'Do not engage unless necessary.' },
  { code: 'PSC-0423', type: 'RETRIEVAL', place: 'ST. NIKOLAI', poi: 'church', level: 1, base: 900, item: 'dogtag', itemName: 'Explorer tag', prompt: 'PICK UP · EXPLORER TAG', mesh: 'tag', where: 'the graveyard behind the church', spotKind: 'floor', fallback: [62, -238],
    body: 'Recover the tag of Explorer 44 from the graveyard behind the Church of St. Nikolai. Last transmission day 9, 21:40, from the hill.', entities: '2 (class Mimic), 1 (class Slider) unconfirmed', note: 'Remains are not to be moved.' },
  { code: 'PSC-0431', type: 'RETRIEVAL', place: 'MARSH VENTS', poi: 'vents', level: 1, base: 900, item: 'samples', itemName: 'Soil samples', prompt: 'PICK UP · SAMPLE CASE', mesh: 'case', where: 'the vent margin, lower marsh', spotKind: 'floor', fallback: [-84, 176],
    body: 'Recover the sealed sample case left at the vent margin by survey team 3. Three vials. Do not open.', entities: '0 confirmed; gas anomaly active', note: 'Probe before every step.' },
  { code: 'PSC-0438', type: 'RETRIEVAL', place: 'CONVOY', poi: 'convoy', level: 1, base: 900, item: ['manifest', 'recorder'], itemName: 'Sealed case', prompt: 'PICK UP · SEALED CASE', mesh: 'casegrey', where: 'the lead URAL cab, convoy wreck', spotKind: 'shelf', fallback: [52, 154],
    body: 'Recover the sealed case from the cab of the lead URAL. Contents: convoy manifest, route recorder. The convoy did not reach Checkpoint 2.', entities: '1 (class Slider) reported in the wrecks', note: 'Approach from the road side.' },
  { code: 'PSC-0442', type: 'RETRIEVAL', place: 'DEAD FOREST', poi: 'forest', level: 2, base: 1100, item: 'samples', itemName: 'Ash samples', prompt: 'PICK UP · SAMPLE CASE', mesh: 'case', where: 'the forest floor, western stand', spotKind: 'floor', fallback: [-236, -64],
    body: 'Recover the ash sample case cached in the dead forest, western stand. Three vials, sealed at index 2.', entities: '3 (class Mimic) patrolling in pairs', note: 'Visibility in the stand is under 20 m.' },
  // SURVEY — plant 3 beacons at listed coordinates
  { code: 'PSC-0451', type: 'SURVEY', place: 'LOWER MARSH', poi: 'marsh', level: 1, base: 700, points: [[-70, 120], [-20, 150], [-48, 186]],
    body: 'Plant three survey beacons in the lower marsh at the listed squares. Beacons are issued with this contract.', entities: '1 (class Slider) in the reeds', note: 'The marsh floor is not stable. Stay on the tussocks.' },
  { code: 'PSC-0453', type: 'SURVEY', place: 'ANOMALY FIELD A', poi: 'field_a', level: 1, base: 800, points: [[-86, -30], [-56, -70], [-30, -22]],
    body: 'Plant three survey beacons on the margin of anomaly field A (electric). Beacons are issued with this contract.', entities: '0 confirmed; arc discharge every 4 to 9 s', note: 'Probe the ground between the beacons.' },
  { code: 'PSC-0457', type: 'SURVEY', place: 'RAIL CUTTING', poi: 'rail', level: 2, base: 900, points: [[-100, -138], [-56, -150], [-8, -156]],
    body: 'Plant three survey beacons along the rail cutting. The Committee requires the grade line measured after the last Tide.', entities: 'class Spawn, count unknown, in the cutting', note: 'Beacons on the embankment, not in the cut.' },
  { code: 'PSC-0461', type: 'SURVEY', place: 'ANOMALY FIELD B', poi: 'field_b', level: 2, base: 950, points: [[196, 50], [240, 96], [252, 46]],
    body: 'Plant three survey beacons around anomaly field B (reflector). Beacons are issued with this contract.', entities: '2 (class Mimic) at the eastern fence', note: 'Reflectors return fire. Do not shoot into the field.' },
  // CLEARANCE — destroy N entities of a class at a POI
  { code: 'PSC-0471', type: 'CLEARANCE', place: 'KOLKHOZ ZARYA', poi: 'zarya', level: 1, base: 520, enemy: 'mimic', count: 2,
    body: 'Destroy two entities (class Mimic) within the kolkhoz "Zarya" perimeter. Confirmed by telemetry on your return.', entities: '2 (class Mimic), possibly 3', note: 'They stand still in doorways. Look twice.' },
  { code: 'PSC-0474', type: 'CLEARANCE', place: 'CONVOY', poi: 'convoy', level: 1, base: 700, enemy: 'slider', count: 1,
    body: 'Destroy one entity (class Slider) at the convoy wreck. It has taken two Explorers from the road since day 6.', entities: '1 (class Slider)', note: 'It lies flat under the trailers. Keep your back to a wall.' },
  { code: 'PSC-0477', type: 'CLEARANCE', place: 'OBJECT 12', poi: 'object12', level: 2, base: 560, enemy: 'mimic', count: 3,
    body: 'Destroy three entities (class Mimic) inside the substation fence. The Committee requires the yard clear for the restoration team.', entities: '3 (class Mimic); Seeker activity above index 2', note: 'Do not engage the Seeker. It is not part of this contract.' },
  { code: 'PSC-0481', type: 'CLEARANCE', place: 'RAIL CUTTING', poi: 'rail', level: 2, base: 300, enemy: 'spawn', count: 4,
    body: 'Destroy four entities (class Spawn) in the rail cutting. They nest under the wagons.', entities: 'class Spawn, packs of 3 to 6', note: 'Shotgun recommended. They come from below.' },
  { code: 'PSC-0486', type: 'CLEARANCE', place: 'ANOMALY FIELD C', poi: 'field_c', level: 2, base: 450, enemy: 'fragment', count: 3,
    body: 'Destroy three entities (class Fragment) drifting over anomaly field C (gravity). One round each. Do not let them touch you.', entities: '3 to 5 (class Fragment)', note: 'They accelerate inside 25 m.' },
  // ARTIFACT — deliver one artifact of a named type
  { code: 'PSC-0491', type: 'ARTIFACT', place: 'PEARL', poi: 'field_b', level: 1, artifact: 'art_pearl', premium: 1.35,
    body: 'Deliver one artifact of type Pearl. Reported near anomaly field B and the marsh vents. Detector recommended.', entities: 'as per the field', note: 'Committee purchase, above field rate.' },
  { code: 'PSC-0493', type: 'ARTIFACT', place: 'EMBER', poi: 'vents', level: 1, artifact: 'art_ember', premium: 1.35,
    body: 'Deliver one artifact of type Ember. Reported at the marsh vents and along the eastern road. Do not carry it against the body.', entities: 'as per the field', note: 'Committee purchase, above field rate.' },
  { code: 'PSC-0495', type: 'ARTIFACT', place: 'TEAR', poi: 'field_a', level: 2, artifact: 'art_tear', premium: 1.4,
    body: 'Deliver one artifact of type Tear. Reported inside anomaly field A after each discharge cycle.', entities: 'as per the field', note: 'Committee purchase, above field rate.' },
  { code: 'PSC-0497', type: 'ARTIFACT', place: 'CROWN', poi: 'field_c', level: 3, artifact: 'art_crown', premium: 1.5,
    body: 'Deliver one artifact of type Crown. Reported once, anomaly field C, day 11. Committee priority. Do not open.', entities: 'as per the field', note: 'Priority purchase. Section 61 will be informed.' },
];
// the scripted chain: one step per security level
const CHAIN = [
  { code: 'PSC-0401', type: 'RECON', place: 'CHECKPOINT 2', poi: 'checkpoint', level: 1, pay: 1200, chain: 0,
    points: [[22, 204]], item: ['guardlog', 'recorder'], itemName: 'Guard log', prompt: 'PICK UP · GUARD LOG', mesh: 'log', where: 'the guard hut, Checkpoint 2', spotKind: 'shelf', fallback: [27, 216],
    body: 'Survey Checkpoint 2: plant one beacon at the barrier line and recover the post guard log from the hut. The checkpoint was UNPSC until the second day of the event. One beacon is issued with this contract.', entities: '1 (class Mimic) unconfirmed', note: 'The barrier is down. Go around it.' },
  { code: 'PSC-0455', type: 'RESTORATION', place: 'OBJECT 12', poi: 'object12', level: 2, pay: 3500, chain: 1,
    item: 'recorder', itemName: 'Replacement recorder', where: 'the control room bracket, Object 12', fallback: [154, -54], spotKind: 'shelf',
    body: 'Object 12: restore the recorder. A replacement unit is issued with this contract. Install it in the control room bracket. The Committee requires substation telemetry before the next Tide.', entities: '2 to 3 (class Mimic); Seeker activity possible above index 2', note: 'Installation takes four seconds. Clear the room first.' },
  { code: 'PSC-0499', type: 'RELAY', place: 'NORTHERN RIDGE', poi: 'north', level: 3, pay: 10000, chain: 2,
    relay: [0, -300], item: ['relay', 'beacon'], itemName: 'Relay',
    body: 'Plant the relay on the northern ridge, square {SQ}, in line of sight of the Column. The relay is issued with this contract. This is the last contract under section 61.', entities: 'unknown', note: 'Nothing has reported back from the ridge.' },
];

export function createMissions(ctx) {
  const { THREE: T, scene } = ctx;
  const objs = new Map();               // mission id -> [{ root, mats, geos, unregister }]
  const blinkers = [];                  // { mat, phase, mode:'beacon'|'led'|'steady' }
  const objTarget = new THREE.Vector3();
  const _v = new THREE.Vector3();
  let objectiveKey = '', objT = 0;
  let seq = null;                       // the relay sequence { t, m, sprite, tide }
  const missionsData = () => {
    const d = ctx.state.data;
    if (!d.missions) d.missions = { active: [], completed: [], chainStep: 0 };
    const m = d.missions;
    if (!Array.isArray(m.active)) m.active = []; if (!Array.isArray(m.completed)) m.completed = []; if (!Array.isArray(m.available)) m.available = [];
    if (typeof m.chainStep !== 'number') m.chainStep = 0; if (typeof m.gen !== 'number') m.gen = 0;
    return m;
  };
  const poiOf = (id) => ctx.world.poi(id);
  const distFromBase = (poi) => Math.hypot(poi.x - ctx.world.map.BASE.x, poi.z - ctx.world.map.BASE.z);

  // ---- record construction ----
  function build(tpl, suffix = '') {
    const d = ctx.state.data, poi = poiOf(tpl.poi), tide = d.tideLevel;
    const distK = 1 + distFromBase(poi) / 400, tideK = 1 + 0.2 * (tide - 1);
    let payment;
    if (tpl.chain != null) payment = tpl.pay;
    else if (tpl.type === 'ARTIFACT') payment = ITEMS[tpl.artifact].price * (tpl.premium + 0.1 * (tide - 1));
    else if (tpl.type === 'CLEARANCE') payment = tpl.base * tpl.count * distK * tideK;
    else payment = tpl.base * distK * tideK;
    payment = Math.round(payment / 50) * 50;
    const code = tpl.code + suffix;
    const m = {
      id: code, code, type: tpl.type, place: tpl.place, title: `${tpl.type} / ${tpl.place}`, heading: `${code} / ${tpl.type} / ${tpl.place}`,
      poi: tpl.poi, poiName: poi.name, level: tpl.level, payment, chain: tpl.chain ?? null, status: 'offered',
      requirements: [`Security level ${tpl.level}`],
      body: '',
    };
    let extra = '';
    if (tpl.points) { m.points = tpl.points.map(([x, z]) => ({ x, z, label: square(x, z), done: false })); extra = ` Coordinates: ${m.points.map((p) => 'square ' + p.label).join(', ')}.`; m.requirements.push(`${m.points.length} beacon${m.points.length > 1 ? 's' : ''} issued at acceptance`); }
    if (tpl.item) { m.item = resolveItem(tpl.item); m.itemName = tpl.itemName; m.prompt = tpl.prompt; m.mesh = tpl.mesh; m.where = tpl.where; m.spotKind = tpl.spotKind; m.fallback = tpl.fallback; m.spot = null; }
    if (tpl.enemy) { m.enemyType = tpl.enemy; m.enemyName = ENEMY_NAMES[tpl.enemy]; m.count = tpl.count; m.kills = 0; }
    if (tpl.artifact) { m.artifact = tpl.artifact; m.artifactName = ART_NAMES[tpl.artifact]; m.requirements.push('Detector recommended'); }
    if (tpl.relay) { m.relay = { x: tpl.relay[0], z: tpl.relay[1], label: square(tpl.relay[0], tpl.relay[1]) }; m.planted = false; }
    if (tpl.chain === 1) m.installed = false;
    const payLine = tpl.chain === 2 ? `Payment ${money(payment)} ₽ on signal confirmation.` : tpl.chain === 1 ? `Payment ${money(payment)} ₽ on confirmation.` : `Payment ${money(payment)} ₽ on delivery.`;
    m.body = `${tpl.body.replace('{SQ}', m.relay ? m.relay.label : '')}${extra} Anomalous activity index ${tide}. Entities reported: ${tpl.entities}. ${tpl.note} ${payLine}`;
    return m;
  }
  function reissueSuffix(code) {
    const n = missionsData().completed.filter((c) => c.code === code || c.code.startsWith(code + '-')).length;
    return n === 0 ? '' : '-' + String.fromCharCode(65 + Math.min(n, 24));
  }
  function chainOffer() {
    const md = missionsData(), d = ctx.state.data;
    if (md.chainStep >= CHAIN.length) return null;
    const tpl = CHAIN[md.chainStep];
    if (d.securityLevel < tpl.level) return null;
    if (md.active.some((m) => m.chain === tpl.chain)) return null;
    if (!md.chainOffer || md.chainOffer.chain !== tpl.chain) md.chainOffer = build(tpl);
    return md.chainOffer;
  }

  // ---- world objects ----
  const geoCache = {};
  const shared = (g) => { g.userData.shared = true; return g; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);
  function geo(kind) {
    if (geoCache[kind]) return geoCache[kind];
    const grey = [0.36, 0.38, 0.35], dark = [0.18, 0.18, 0.19], steel = [0.42, 0.43, 0.44], paper = [0.72, 0.70, 0.62], wood = [0.42, 0.35, 0.25], orange = [0.78, 0.40, 0.16];
    let g;
    switch (kind) {
      case 'recorder': case 'log':
        g = merge([
          place(paint(box(0.30, 0.12, 0.20), kind === 'log' ? [0.32, 0.36, 0.28] : grey, { rust: 0.12, seed: 71 }), 0, 0.06, 0),
          place(paint(box(0.302, 0.006, 0.202), dark, { seed: 72 }), 0, 0.09, 0),                                // lid seam
          place(paint(cyl(0.012, 0.012, 0.02, 8), dark, { seed: 73 }), 0.10, 0.05, 0.105, [Math.PI / 2, 0, 0]),  // connector
          place(paint(box(0.10, 0.002, 0.05), paper, { jitter: 0.1, grime: 0.5, seed: 74, scale: 80 }), -0.05, 0.121, 0.03), // label
          place(paint(box(0.05, 0.012, 0.012), steel, { seed: 75 }), -0.12, 0.128, -0.06),                        // catch
        ]); break;
      case 'case': case 'casegrey':
        g = merge([
          place(paint(box(0.36, 0.13, 0.26), kind === 'case' ? [0.33, 0.35, 0.29] : [0.24, 0.25, 0.26], { rust: 0.1, seed: 81, scale: 30 }), 0, 0.065, 0),
          place(paint(box(0.36, 0.004, 0.26), dark, { seed: 82 }), 0, 0.09, 0),
          place(paint(box(0.03, 0.03, 0.01), steel, { seed: 83 }), -0.11, 0.08, 0.133),
          place(paint(box(0.03, 0.03, 0.01), steel, { seed: 83 }), 0.11, 0.08, 0.133),
          place(paint(new THREE.TorusGeometry(0.05, 0.007, 6, 10, Math.PI), dark, { seed: 84 }), 0, 0.132, 0.0),
          place(paint(box(0.12, 0.03, 0.002), kind === 'case' ? paper : [0.80, 0.72, 0.40], { jitter: 0.1, grime: 0.4, seed: 85, scale: 80 }), 0.04, 0.06, 0.131),
        ]); break;
      case 'tag':
        g = merge([
          place(paint(box(0.06, 0.003, 0.10), [0.56, 0.56, 0.52], { jitter: 0.05, seed: 91, scale: 80 }), 0, 0.0035, 0, [0, 0.4, 0]),
          ...[0, 1, 2, 3, 4, 5].map((i) => place(paint(new THREE.TorusGeometry(0.011, 0.0025, 4, 8), [0.5, 0.5, 0.48], { seed: 92 }), -0.03 - i * 0.02, 0.004, 0.05 + Math.sin(i * 0.9) * 0.02, [Math.PI / 2, 0, i * 0.5])),
        ]); break;
      case 'stake':
        g = merge([
          place(paint(cyl(0.014, 0.018, 0.75, 6), wood, { jitter: 0.1, grime: 0.5, seed: 101, scale: 50 }), 0, 0.375, 0),
          place(paint(box(0.15, 0.09, 0.004), orange, { jitter: 0.12, grime: 0.55, seed: 102, scale: 60 }), 0.085, 0.66, 0, [0, 0, -0.12]),
        ]); break;
      case 'beacon': {
        const parts = [];
        for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; parts.push(place(paint(cyl(0.012, 0.014, 1.15, 6), dark, { seed: 111 }), Math.sin(a) * 0.30, 0.55, Math.cos(a) * 0.30, [Math.cos(a) * 0.27, 0, -Math.sin(a) * 0.27])); }
        parts.push(place(paint(box(0.15, 0.11, 0.15), [0.30, 0.31, 0.29], { seed: 112 }), 0, 1.15, 0));
        parts.push(place(paint(cyl(0.004, 0.004, 0.5, 5), steel, { seed: 113 }), 0.05, 1.45, 0.05));
        parts.push(place(paint(box(0.16, 0.004, 0.10), [0.16, 0.18, 0.24], { seed: 114 }), 0, 1.21, 0, [0.2, 0, 0]));   // solar plate
        g = merge(parts); break;
      }
      case 'relay': {
        const parts = [];
        for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.3; parts.push(place(paint(cyl(0.02, 0.024, 1.7, 6), dark, { seed: 121 }), Math.sin(a) * 0.45, 0.8, Math.cos(a) * 0.45, [Math.cos(a) * 0.27, 0, -Math.sin(a) * 0.27])); }
        parts.push(place(paint(box(0.32, 0.22, 0.30), [0.30, 0.31, 0.29], { rust: 0.08, seed: 122 }), 0, 1.72, 0));
        parts.push(place(paint(cyl(0.012, 0.012, 1.2, 6), steel, { seed: 123 }), 0, 2.4, 0));
        parts.push(place(paint(box(0.5, 0.012, 0.012), steel, { seed: 124 }), 0, 2.85, 0));
        parts.push(place(paint(new THREE.ConeGeometry(0.42, 0.14, 18, 1, true), [0.55, 0.56, 0.55], { seed: 125, scale: 20 }), 0, 2.1, -0.2, [-Math.PI / 2 + 0.5, 0, 0]));   // dish facing north and up
        parts.push(place(paint(box(0.22, 0.10, 0.004), paper, { jitter: 0.1, grime: 0.4, seed: 126, scale: 60 }), 0, 1.72, 0.152));
        g = merge(parts); break;
      }
      case 'bracket':
        g = merge([
          place(paint(box(0.36, 0.26, 0.02), steel, { rust: 0.25, seed: 131, scale: 30 }), 0, 0.22, -0.11),
          place(paint(box(0.36, 0.02, 0.22), steel, { rust: 0.2, seed: 132, scale: 30 }), 0, 0.01, 0),
          place(paint(cyl(0.012, 0.012, 0.01, 6), dark, { seed: 133 }), -0.14, 0.32, -0.10, [Math.PI / 2, 0, 0]),
          place(paint(cyl(0.012, 0.012, 0.01, 6), dark, { seed: 133 }), 0.14, 0.32, -0.10, [Math.PI / 2, 0, 0]),
        ]); break;
    }
    geoCache[kind] = shared(g);
    return g;
  }
  const ledGeo = shared(new THREE.SphereGeometry(0.012, 8, 6));
  const lampGeo = shared(new THREE.SphereGeometry(0.032, 10, 8));

  function addMesh(m, kind, x, y, z, yaw = 0, opts = {}) {
    const mat = bodyMaterial({ roughness: opts.roughness ?? 0.82, metalness: opts.metalness ?? 0.2 });
    const root = new T.Group(); root.position.set(x, y, z); root.rotation.y = yaw;
    const mesh = new T.Mesh(geo(kind), mat); mesh.castShadow = opts.cast ?? true; mesh.receiveShadow = true; root.add(mesh);
    const rec = { root, mats: [mat], unregister: null, blink: null };
    if (opts.led) {
      const lm = ledMaterial(opts.led, opts.ledIntensity ?? 2.6);
      const l = new T.Mesh(opts.lamp ? lampGeo : ledGeo, lm); l.position.set(opts.ledAt[0], opts.ledAt[1], opts.ledAt[2]); root.add(l);
      rec.mats.push(lm);
      rec.blink = { mat: lm, phase: Math.random() * 10, mode: opts.blink || 'led', peak: opts.ledIntensity ?? 2.6 };
      blinkers.push(rec.blink);
    }
    scene.add(root);
    if (!objs.has(m.id)) objs.set(m.id, []);
    objs.get(m.id).push(rec);
    return rec;
  }
  function disposeMission(id) {
    const list = objs.get(id); if (!list) return;
    for (const r of list) {
      r.unregister?.(); scene.remove(r.root);
      r.root.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
      for (const mt of r.mats) mt.dispose();
      if (r.blink) { const i = blinkers.indexOf(r.blink); if (i >= 0) blinkers.splice(i, 1); }
    }
    objs.delete(id);
  }
  function disposeAll() { for (const id of [...objs.keys()]) disposeMission(id); }

  // pick where a retrieval object sits: a registered loot spot of that POI (preferring the template kind), else the fallback point
  function pickSpot(m) {
    if (m.spot) return m.spot;
    const all = ctx.world.lootSpots.filter((s) => s.poi === m.poi && s.position);
    // loot has already claimed some of these spots (it re-rolls before missions on every start and Tide); keep the object clear of a container
    const taken = ctx.loot?.objects || [];
    const free = all.filter((s) => !taken.some((o) => Math.abs(o.x - s.position.x) < 0.7 && Math.abs(o.z - s.position.z) < 0.7));
    const spots = free.length ? free : all;
    const rnd = ctx.rng.fork(1300 + m.code.charCodeAt(6) * 31 + ctx.state.data.tideLevel * 7);
    let p = null;
    const pref = spots.filter((s) => s.kind === m.spotKind);
    if (pref.length) p = rnd.pick(pref).position; else if (spots.length) p = rnd.pick(spots).position;
    if (p) m.spot = { x: p.x, y: p.y, z: p.z };
    else { const [x, z] = m.fallback; const y = ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2).y; m.spot = { x, y, z }; }
    return m.spot;
  }
  function pointY(x, z) { return ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2).y; }
  function deny(text) { ctx.audio.play('ui_deny', { gain: 0.5 }); ctx.hud.notify(text, { code: 'UNPSC · ADVISORY', ms: 4500, sound: false }); }

  function materialize(m) {
    disposeMission(m.id);
    // retrieval objects (also the chain-1 guard log)
    if (m.item && m.mesh && !m.recovered) {
      const s = pickSpot(m);
      const rec = addMesh(m, m.mesh, s.x, s.y, s.z, (s.x * 13.7 + s.z * 3.1) % 6.28, m.mesh === 'recorder' || m.mesh === 'log' ? { led: 0xff2a18, ledAt: [0.11, 0.128, 0.08], blink: 'led', cast: false } : { cast: false });
      rec.unregister = ctx.interact.register({
        position: new THREE.Vector3(s.x, s.y + 0.3, s.z), radius: 2.4, prompt: m.prompt,
        onInteract() {
          ctx.inventory.add(m.item, 1);
          m.recovered = true;
          ctx.audio.play('pickup_item', { gain: 0.7 });
          ctx.hud.notify(`Recovered: ${m.itemName}. ${m.points && !m.points.every((p) => p.done) ? 'Beacon outstanding.' : 'Return to Vanno.'}`, { code: m.code, ms: 5000, sound: false });
          disposeMission(m.id); materialize(m);
          ctx.state.save(); refreshObjective(true);
        },
      });
    }
    // survey points: a stake where a beacon is due, a planted beacon where it has been done
    if (m.points) for (const p of m.points) {
      const y = pointY(p.x, p.z);
      if (p.done) { addMesh(m, 'beacon', p.x, y, p.z, (p.x * 7.3) % 6.28, { led: 0xffa040, ledAt: [0, 1.24, 0], lamp: true, blink: 'beacon', ledIntensity: 3.2 }); continue; }
      const rec = addMesh(m, 'stake', p.x, y, p.z, (p.x * 5.1 + p.z) % 6.28, { cast: false });
      rec.unregister = ctx.interact.register({
        position: new THREE.Vector3(p.x, y + 0.6, p.z), radius: 3.2, hold: 1.2,
        prompt: () => (ctx.inventory.has('beacon') ? `PLANT BEACON · SQUARE ${p.label}` : `SURVEY POINT · SQUARE ${p.label}`),
        onInteract() {
          if (!ctx.inventory.remove('beacon', 1)) { deny('No beacon carried. Beacons are issued with the contract at the Vanno terminal.'); return; }
          p.done = true;
          ctx.audio.play('ui_stamp', { gain: 0.5 });
          const left = m.points.filter((q) => !q.done).length;
          ctx.hud.notify(left > 0 ? `Beacon planted at square ${p.label}. ${left} outstanding.` : `Beacon planted at square ${p.label}. Survey complete. Return to Vanno.`, { code: m.code, ms: 5000 });
          disposeMission(m.id); materialize(m);
          ctx.state.save(); refreshObjective(true);
        },
      });
    }
    // chain 2: the control room bracket; the replacement unit is installed with a hold
    if (m.chain === 1) {
      const s = pickSpot(m);
      addMesh(m, 'bracket', s.x, s.y, s.z, 0, { cast: false });
      if (m.installed) addMesh(m, 'recorder', s.x, s.y + 0.02, s.z, 0, { led: 0x40ff70, ledAt: [0.11, 0.128, 0.08], blink: 'steady', ledIntensity: 2.2, cast: false });
      else {
        const rec = objs.get(m.id)[0];
        rec.unregister = ctx.interact.register({
          position: new THREE.Vector3(s.x, s.y + 0.3, s.z), radius: 2.4, hold: 4.0,
          prompt: () => (ctx.inventory.has('recorder') ? 'INSTALL RECORDER · BRACKET' : 'RECORDER BRACKET · EMPTY'),
          onInteract() {
            if (!ctx.inventory.remove('recorder', 1)) { deny('No unit carried. The replacement recorder is issued with the contract.'); return; }
            m.installed = true;
            ctx.audio.play('ui_stamp', { gain: 0.5 }); ctx.audio.play('click', { gain: 0.5 });
            ctx.hud.notify('Recorder installed. Telemetry link established. Return to Vanno.', { code: m.code, ms: 6000 });
            disposeMission(m.id); materialize(m);
            ctx.state.save(); refreshObjective(true);
          },
        });
      }
    }
    // chain 3: the relay point on the ridge
    if (m.relay) {
      const { x, z } = m.relay, y = pointY(x, z);
      if (m.planted) addMesh(m, 'relay', x, y, z, 0, { led: 0xbfe0ff, ledAt: [0, 2.95, 0], lamp: true, blink: 'beacon', ledIntensity: 3.5 });
      else {
        const rec = addMesh(m, 'stake', x, y, z, 0.7, { cast: false });
        rec.unregister = ctx.interact.register({
          position: new THREE.Vector3(x, y + 0.6, z), radius: 4.0, hold: 2.0,
          prompt: () => (ctx.inventory.has(m.item) ? `PLANT RELAY · SQUARE ${m.relay.label}` : `RELAY POINT · SQUARE ${m.relay.label}`),
          enabled: () => !seq,
          onInteract() {
            if (!ctx.inventory.remove(m.item, 1)) { deny('No relay carried. The relay is issued with the contract.'); return; }
            m.planted = true;
            disposeMission(m.id); materialize(m);
            startRelaySequence(m);
            ctx.state.save(); refreshObjective(true);
          },
        });
      }
    }
  }

  // ---- the relay sequence: the Column answers ----
  function startRelaySequence(m) {
    // the sky combines tide.js's base with this boost, so the two never fight over one uniform
    const s = { t: 0, m, sprite: null };
    const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(), color: 0xdfe8ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    const cp = ctx.sky.columnPosition; sp.position.set(cp.x, 160, cp.z); sp.scale.set(300, 900, 1); scene.add(sp);
    s.sprite = sp;
    s.restore = () => { ctx.sky.tideBoost = 0; scene.remove(sp); sp.material.dispose(); };
    seq = s;
    ctx.post.flash(0.7);
    ctx.audio.play('tide_chord', { gain: 0.5, rate: 0.72 });
    ctx.audio.play('ui_stamp', { gain: 0.5 });
  }
  function updateSequence(dt) {
    const s = seq; s.t += dt;
    const k = Math.sin(Math.PI * clamp(s.t / 6, 0, 1));
    ctx.sky.tideBoost = 0.3 * k;
    s.sprite.material.opacity = 0.85 * k;
    s.sprite.scale.set(300 + 200 * k, 900 + 300 * k, 1);
    if (s.t > 2.9 && s.t - dt <= 2.9) ctx.post.flash(0.35);
    if (s.t >= 6) {
      s.restore(); seq = null;
      const m = s.m;
      ctx.hud.notify('Relay active. Signal returned from the Column. Contract 61 concluded. Extension requested by Explorer 61.', { code: 'UNPSC · CONTRACT 61', ms: 12000 });
      ctx.state.data.flags.concluded = true;
      api.complete(m.id, { silent: true });
    }
  }

  // ---- objective (primary active mission) ----
  function objectiveFor(m) {
    const M = ctx.world.map, poi = poiOf(m.poi);
    if (api.deliverable(m)) return { text: m.chain === 1 ? 'Telemetry restored. Report at the Vanno terminal.' : m.type === 'CLEARANCE' || m.type === 'SURVEY' ? 'Count met. Report at the Vanno terminal.' : `Deliver ${m.itemName ? m.itemName.toLowerCase() : 'the ' + m.artifactName} at the Vanno terminal.`, x: M.BASE.x, z: M.BASE.z };
    if (m.relay) return { text: ctx.inventory.has(m.item) ? `Plant the relay · square ${m.relay.label}` : 'Relay lost. Return to Vanno.', x: m.relay.x, z: m.relay.z };
    if (m.chain === 1) { const s = pickSpot(m); return { text: ctx.inventory.has('recorder') ? 'Install the recorder · Object 12 control room' : 'Replacement recorder lost. Obtain a recorder.', x: s.x, z: s.z }; }
    if (m.points) {
      const next = m.points.find((p) => !p.done);
      if (next) { const n = m.points.filter((p) => p.done).length; return { text: `Plant beacon ${n + 1} of ${m.points.length} · square ${next.label}`, x: next.x, z: next.z }; }
    }
    if (m.item) { if (!m.recovered) { const s = pickSpot(m); return { text: `Recover ${m.itemName.toLowerCase()} · ${m.where}`, x: s.x, z: s.z }; } return { text: `${m.itemName} lost. Return to Vanno.`, x: M.BASE.x, z: M.BASE.z }; }
    if (m.enemyType) return { text: `Destroy ${m.count} (class ${m.enemyName}) · ${m.poiName} · ${m.kills}/${m.count}`, x: poi.x, z: poi.z };
    if (m.artifact) return { text: `Deliver one ${m.artifactName} · reported near ${poi.name}`, x: poi.x, z: poi.z };
    return { text: m.title, x: poi.x, z: poi.z };
  }
  function refreshObjective(force = false) {
    const m = missionsData().active[0];
    if (!m) { if (objectiveKey !== '') { objectiveKey = ''; ctx.hud.setObjective('', '', null); } return; }
    const o = objectiveFor(m);
    const key = m.id + '|' + o.text;
    if (!force && key === objectiveKey) return;
    objectiveKey = key;
    objTarget.set(o.x, ctx.world.getHeight(o.x, o.z), o.z);
    ctx.hud.setObjective(m.code, o.text, objTarget);
  }

  // ---- security level ----
  function checkLevel() {
    const d = ctx.state.data;
    // Clearance had TWO contradictory ladders. This one read money alone, ignored contracts
    // completed and stopped at 3; ui/panel_terminal.js used rankFor(earned, missions) and went to 5.
    // Both only ever raise, so the looser rule won: clearance could be bought outright by selling
    // artifacts, with no contract ever completed. One ladder now, the same one the terminal quotes.
    const lvl = rankFor(d.earned || 0, missionsData().completed.length);
    if (lvl <= d.securityLevel) return;
    d.securityLevel = lvl;
    const grade = RANKS.find((r) => r.rank === lvl);
    ctx.hud.notify(`Security level ${lvl} granted${grade && grade.title ? ` — ${grade.title}` : ''}. Supply access widened.`, { code: 'UNPSC · CLEARANCE', ms: 8000 });
    ctx.audio.play('ui_stamp', { gain: 0.6 });
    api.generate();
  }

  const api = {
    get active() { return missionsData().active; },
    get completed() { return missionsData().completed; },
    get sequence() { return seq; },
    get objects() { return objs; },          // mission id -> world objects (tests, tide checks)
    available() {
      const md = missionsData();
      if (md.available.length === 0) api.generate();
      const chain = chainOffer();
      return chain ? [chain, ...md.available] : md.available.slice();
    },
    // regenerate the offer list: 3-4 templates for the current level, one of each type first
    generate() {
      const md = missionsData(), d = ctx.state.data;
      md.gen++;
      const rnd = ctx.rng.fork(400 + md.gen * 17 + d.securityLevel * 3);
      const activeCodes = new Set(md.active.map((m) => m.code.slice(0, 8)));
      const pool = TEMPLATES.filter((t) => t.level <= d.securityLevel && !activeCodes.has(t.code));
      const byType = {};
      for (const t of pool) (byType[t.type] ||= []).push(t);
      const chosen = [];
      for (const type of ['RETRIEVAL', 'SURVEY', 'CLEARANCE', 'ARTIFACT']) if (byType[type]?.length) chosen.push(rnd.pick(byType[type]));
      const want = rnd.int(3, 4);
      const rest = pool.filter((t) => !chosen.includes(t)).sort(() => rnd() - 0.5);
      while (chosen.length < want && rest.length) chosen.push(rest.pop());
      while (chosen.length > want) chosen.splice(rnd.int(0, chosen.length - 1), 1);
      md.available = chosen.map((t) => build(t, reissueSuffix(t.code)));
      return md.available;
    },
    find(id) { const md = missionsData(); return md.active.find((m) => m.id === id) || md.available.find((m) => m.id === id) || (md.chainOffer?.id === id ? md.chainOffer : null); },
    accept(idOrM) {
      const md = missionsData();
      const id = typeof idOrM === 'string' ? idOrM : idOrM?.id;
      const m = api.find(id);
      if (!m || m.status === 'active') return false;
      if (md.active.length >= MAX_ACTIVE) { ctx.hud.notify('Two contracts already open. Conclude one before accepting another.', { code: 'UNPSC · TERMINAL', ms: 5000 }); ctx.audio.play('ui_deny', { gain: 0.5 }); return false; }
      if (m.chain != null) md.chainOffer = null; else md.available = md.available.filter((x) => x.id !== m.id);
      m.status = 'active'; m.acceptedDay = ctx.state.data.day;
      md.active.push(m);
      if (m.points) ctx.inventory.add('beacon', m.points.filter((p) => !p.done).length);
      if (m.chain === 1) ctx.inventory.add('recorder', 1);
      if (m.relay) ctx.inventory.add(m.item, 1);
      materialize(m);
      ctx.audio.play('ui_stamp', { gain: 0.7 });
      ctx.hud.notify(`Contract ${m.code} accepted. ${m.title}.`, { code: 'UNPSC · TERMINAL', ms: 5000, sound: false });
      refreshObjective(true);
      ctx.state.save();
      ctx.events.emit('missionAccepted', m);
      return true;
    },
    // can this active mission be concluded at the terminal right now?
    deliverable(m) {
      if (!m) return false;
      if (m.relay) return !!m.planted;
      if (m.chain === 1) return !!m.installed;
      if (m.chain === 0) return !!m.recovered && ctx.inventory.has(m.item) && m.points.every((p) => p.done);
      if (m.type === 'RETRIEVAL') return !!m.recovered && ctx.inventory.has(m.item);   // the object itself, not a unit issued by another contract
      if (m.type === 'SURVEY') return m.points.every((p) => p.done);
      if (m.type === 'CLEARANCE') return m.kills >= m.count;
      if (m.type === 'ARTIFACT') return ctx.inventory.has(m.artifact);
      return false;
    },
    // The terminal calls this when it has it and falls back to withdrawing the record itself when it
    // does not — and it never did, so an abandoned contract kept its crate, beacon or relay standing in
    // the zone with a live pickup prompt for an objective that no longer existed.
    abandon(idOrM) {
      const md = missionsData();
      const id = typeof idOrM === 'string' ? idOrM : idOrM?.id;
      const i = md.active.findIndex((m) => m.id === id);
      if (i < 0) return false;
      const [m] = md.active.splice(i, 1);
      disposeMission(m.id);
      m.status = 'abandoned';
      // issued kit goes back to the Committee, same as the terminal did on its own
      if (m.points) { const n = Math.min(ctx.inventory.count('beacon'), m.points.filter((p) => !p.done).length); if (n > 0) ctx.inventory.remove('beacon', n); }
      if (m.chain === 1 && !m.installed && ctx.inventory.has('recorder')) ctx.inventory.remove('recorder', 1);
      if (m.relay && !m.planted && m.item && ctx.inventory.has(m.item)) ctx.inventory.remove(m.item, 1);
      m.recovered = false; m.spot = null; m.installed = false; m.planted = false;
      if (m.points) for (const p of m.points) p.done = false;
      ctx.events.emit('missionFailed', m);
      if (md.active.length === 0) api.generate();
      refreshObjective(true);
      ctx.state.save();
      return true;
    },
    complete(idOrM, opts = {}) {
      const md = missionsData(), d = ctx.state.data;
      const id = typeof idOrM === 'string' ? idOrM : idOrM?.id;
      const i = md.active.findIndex((m) => m.id === id);
      if (i < 0) return false;
      const m = md.active[i];
      if (!api.deliverable(m)) { ctx.hud.notify(`Contract ${m.code}: conditions not met.`, { code: 'UNPSC · TERMINAL', ms: 4000 }); ctx.audio.play('ui_deny', { gain: 0.5 }); return false; }
      if (m.type === 'RETRIEVAL' || m.chain === 0) ctx.inventory.remove(m.item, 1);
      if (m.type === 'ARTIFACT') ctx.inventory.remove(m.artifact, 1);
      md.active.splice(i, 1);
      // spare beacons go back to the Committee unless another open contract still needs them
      if (m.points || (m.relay && m.item === 'beacon')) { const spare = ctx.inventory.count('beacon'); const needed = md.active.some((o) => (o.points && !o.points.every((p) => p.done)) || (o.relay && o.item === 'beacon' && !o.planted)); if (spare > 0 && !needed) ctx.inventory.remove('beacon', spare); }
      else if (m.relay) { const n = ctx.inventory.count(m.item); if (n > 0) ctx.inventory.remove(m.item, n); }
      m.status = 'completed'; m.completedDay = d.day;
      md.completed.push({ code: m.code, type: m.type, place: m.place, payment: m.payment, day: d.day, chain: m.chain });
      if (md.completed.length > 60) md.completed.splice(0, md.completed.length - 60);
      if (m.chain != null) md.chainStep = Math.max(md.chainStep, m.chain + 1);
      disposeMission(m.id);
      // planted beacons and the relay stay in the zone until the Tide takes them
      if (m.points || m.relay) { m.status = 'done'; materializeStatic(m); }
      ctx.inventory.earn(m.payment);
      if (!opts.silent) ctx.hud.notify(`Contract ${m.code} concluded. ${money(m.payment)} ₽ credited.`, { code: 'UNPSC · TERMINAL', ms: 6000, sound: false });
      ctx.audio.play('mission_complete', { gain: 0.8 });
      checkLevel();
      if (md.active.length === 0 || m.chain == null) api.generate();
      refreshObjective(true);
      ctx.state.save();
      ctx.events.emit('missionCompleted', m);
      return true;
    },
    reset() { disposeAll(); seq?.restore(); seq = null; objectiveKey = ''; },
    update(dt) {
      if (seq) updateSequence(dt);
      const t = ctx.elapsed;
      for (let i = 0; i < blinkers.length; i++) {
        const b = blinkers[i];
        if (b.mode === 'beacon') b.mat.emissiveIntensity = ((t * 0.65 + b.phase) % 1) < 0.07 ? b.peak : 0.12;
        else if (b.mode === 'led') b.mat.emissiveIntensity = 0.6 + 0.5 * Math.sin(t * 2.2 + b.phase) + (((t * 0.4 + b.phase) % 1) < 0.05 ? 2 : 0);
      }
      objT -= dt;
      if (objT <= 0) { objT = 0.25; refreshObjective(false); }
    },
  };
  // static leftovers (planted beacons / relay) after a survey concludes: keyed by id so the Tide can clear them
  function materializeStatic(m) {
    if (m.points) for (const p of m.points) if (p.done) addMesh(m, 'beacon', p.x, pointY(p.x, p.z), p.z, (p.x * 7.3) % 6.28, { led: 0xffa040, ledAt: [0, 1.24, 0], lamp: true, blink: 'beacon', ledIntensity: 3.2 });
    if (m.relay && m.planted) addMesh(m, 'relay', m.relay.x, pointY(m.relay.x, m.relay.z), m.relay.z, 0, { led: 0xbfe0ff, ledAt: [0, 2.95, 0], lamp: true, blink: 'beacon', ledIntensity: 3.5 });
  }

  // ---- events ----
  let pendingNotice = null;
  ctx.events.on('gameStart', () => {
    api.reset();
    const md = missionsData();
    if (md.available.length === 0) api.generate();
    for (const m of md.active) materialize(m);
    refreshObjective(true);
    if (pendingNotice) { const n = pendingNotice; pendingNotice = null; setTimeout(() => { if (ctx.mode === 'playing') ctx.hud.notify(n, { code: 'UNPSC · TERMINAL', ms: 8000 }); }, 3000); }
  });
  ctx.events.on('tide', () => {
    // the zone rearranges itself: objects are re-placed, leftovers are gone, offers are re-rolled
    api.reset();
    const md = missionsData();
    for (const m of md.active) { if (m.item && !m.recovered) m.spot = null; materialize(m); }
    md.chainOffer = null;
    api.generate();
    refreshObjective(true);
  });
  ctx.events.on('enemyKilled', (e) => {
    const md = missionsData();
    if (e.opts && e.opts.scare) return;      // a scripted apparition is not telemetry
    for (const m of md.active) {
      if (m.type !== 'CLEARANCE' || e.type !== m.enemyType || m.kills >= m.count) continue;
      const poi = poiOf(m.poi);
      if (Math.hypot(e.position.x - poi.x, e.position.z - poi.z) > poi.r * 1.4) continue;
      m.kills++;
      ctx.hud.notify(m.kills >= m.count ? `Entity destroyed. Clearance count met, ${m.kills}/${m.count}. Return to Vanno.` : `Entity destroyed. ${m.kills}/${m.count} (class ${m.enemyName}).`, { code: m.code, ms: 4500, sound: false });
      ctx.state.save();
    }
    refreshObjective(true);
  });
  ctx.events.on('earned', () => checkLevel());
  // death in the Radius: contracts whose issued or recovered items were carried go back to the board
  ctx.events.on('playerDied', () => {
    const md = missionsData();
    const keep = [], lost = [];
    for (const m of md.active) {
      // an ARTIFACT contract issues nothing and a retrieval object still in the zone survives; everything else carried is gone
      const needsCarried = (m.type === 'RETRIEVAL' && m.recovered) || (m.points && !m.points.every((p) => p.done)) || (m.chain === 1 && !m.installed) || (m.relay && !m.planted) || (m.chain === 0 && m.recovered);
      (needsCarried ? lost : keep).push(m);
    }
    if (!lost.length) return;
    md.active = keep;
    for (const m of lost) {
      disposeMission(m.id);
      m.status = 'offered'; m.recovered = false; m.spot = null; m.installed = false; m.planted = false;
      if (m.points) for (const p of m.points) p.done = false;
      if (m.chain != null) md.chainOffer = m; else md.available.unshift(m);
    }
    pendingNotice = `Contract${lost.length > 1 ? 's' : ''} ${lost.map((m) => m.code).join(', ')} suspended. Issued items not recovered. Re-listed at the terminal.`;
  });
  return api;
}
