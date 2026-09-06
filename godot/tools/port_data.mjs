// One-off: export the browser build's catalogue (radius/src/data) to JSON for the Godot project.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../radius/src/data/');
const out = resolve(here, '../data/');
mkdirSync(out, { recursive: true });
const m = {
  calibers: await import(resolve(src, 'calibers.js')), magazines: await import(resolve(src, 'magazines.js')), weapons: await import(resolve(src, 'weapons.js')),
  attachments: await import(resolve(src, 'attachments.js')), armor: await import(resolve(src, 'armor.js')), items: await import(resolve(src, 'items.js')),
  loadouts: await import(resolve(src, 'loadouts.js')), loot: await import(resolve(src, 'loot.js')), index: await import(resolve(src, 'index.js')),
};
const dump = (name, obj) => { writeFileSync(resolve(out, name + '.json'), JSON.stringify(obj, null, 1)); console.log(name, Object.keys(obj).length); };
dump('calibers', m.calibers.CALIBERS); dump('ammo', m.calibers.AMMO); dump('magazines', m.magazines.MAGAZINES); dump('weapons', m.weapons.WEAPONS);
dump('attachments', m.attachments.ATTACHMENTS); dump('armor', m.armor.ARMOR); dump('items', m.items.ITEMS);
dump('mimic_classes', m.loadouts.MIMIC_CLASSES); dump('class_mix', m.loadouts.CLASS_MIX); dump('poi_tier', m.loadouts.POI_TIER); dump('seeker', m.loadouts.SEEKER);
dump('containers', m.loot.CONTAINERS); dump('containers_by_poi', m.loot.CONTAINERS_BY_POI); dump('ammo_roll', m.loot.AMMO_ROLL); dump('ranks', Object.fromEntries(m.index.RANKS.map((r) => [r.rank, r])));
const map = await import(resolve(here, '../../radius/src/world/map.js'));
dump('map', { SIZE: map.SIZE, HALF: map.HALF, WATER_LEVEL: map.WATER_LEVEL, POIS: map.POIS, ROADS: map.ROADS, RAIL: map.RAIL, START: map.START, BASE: map.BASE, COLUMN: map.COLUMN });
