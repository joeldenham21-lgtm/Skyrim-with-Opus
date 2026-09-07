# Balance notes — inventory, loot and economy

The catalogue (`data/*.json`, 35 weapons, 31 rounds, 36 magazines, 35 attachments, 32 armour pieces, 58 items) is
twenty times the first build's. These are the numbers that keep it a sane economy, and where they live. Everything
below is verified by `tools/tests/loot_test.gd` (10 000 rolls per table and tier) and `tools/tests/economy_test.gd`
(200 simulated runs from the starter kit).

## Targets
- Starter kit → clearance 2 (6 000 ₽ earned + 2 contracts) in **a couple of good runs**. Simulation: median 2 runs,
  worst of 200 trials 3. A good run = six tier-1 containers, one artifact from the near fields, one level-1 contract.
- **Rare kit is rare.** Rank-5 items never roll below tier 3; epics are 0.3 % of the per-item weight at tier 0 and
  8 % at tier 4 before the price damper. The HK416, 6B43, Altyn, Svarog and Mark 4 are Tide-3 ridge/church finds or
  elite mimic drops, not shelf items.
- **Ammunition is counted.** A tier-1 ammo tin holds 24 rounds on average (crate 37, explorer's pack 17), most of it
  in calibres you own. Nothing in the zone hands out a full loadout; the crate at Vanno sells rounds by the ten.

## Loot (`scripts/loot/loot.gd`)
| Knob | Value | Why |
|---|---|---|
| Location tier | `poi_tier[kind] + tideLevel - 1`, clamped 0..4 | marsh 0, village/checkpoint/convoy/forest/anomaly 1, rail/industrial/church 2, ridge 3; the Tide raises everything |
| Rarity weight per item | common `60 - 4t`, uncommon `25 + 3t`, rare `6 + 5t`, epic `0.5 + 2.2t` | order holds at every tier (44/37/26/9.3 at t4); the original `60-8t / 25+4t` inverted common and uncommon from tier 3 |
| Rank gate | rank ≤ tier + 1 full weight, rank = tier + 2 at ¼, above that 0 | keeps clearance-4/5 kit out of tier 0-2 containers |
| Price damper | kit `1 / (1 + price / 2500)`, ammo `1 / (1 + price / 25)` per round | inside a category the 22 000 ₽ vest is a tenth as likely as a 300 ₽ rig; AP rounds a third as likely as FMJ |
| Ammo quantity | `data/ammo_roll.json` × **0.75** (common 9-30, uncommon 6-18, rare 4-11, epic 2-6) | the tables were written for a 4-gun game |
| Owned-calibre bias | 45 % of ammo rolls restricted to calibres of carried weapons | loot stays useful without being a vending machine |
| Found weapons | condition 30-70 % (+8 %/tier), dirt 0.25-0.7, magazine 0-100 %, chamber 60 %, one fitting attachment at 10 % + 5 %/tier | a gun from a crate needs the bench before it is trusted |
| Found magazines | 40 % empty, otherwise 1..cap of the default round | |
| Found armour | durability 40-100 % of new; battery gear 20-100 % charge | |
| Empty chance | table `empty` (10-30 %); desks and shelves also roll 0-2 so they read empty 53 % of the time | not every drawer has something |
| Locks | lockers 35 %, safes 90 % locked; lockpick 60 % per try, 3 tries per pick; `key_locker` (7 % of desk entries) opens either | a safe is a payday (≈3 100 ₽ at tier 1, artifacts inside) and costs a pick or a key |
| Explorer corpses | one each at church, rail, marsh, forest, ridge; explorer's pack table + tag, effects 70 %, letter 35 %, a worn weapon 45 %, armour 30 %, a med 50 % | ≈1 300 ₽ each; they are the "someone died here" beats, re-placed by the Tide |
| Records | `Game.state.flags.loot[key]`, 320 newest kept, wiped by the Tide | a half-emptied crate stays half empty across a save |

Structure kinds map to tables through `containers_by_poi.json` (only the compatible tables at that POI kind):
`crate` → ammo crate / weapon crate / footlocker / ammo tin / ration box / toolbox, `locker` → armour locker /
footlocker, `safe` → safe, `desk` → desk, `cabinet` → medical cabinet / shelf / toolbox, `bag` → medical bag / ammo
tin / explorer's pack, `corpse` → explorer's pack. Unknown POI → equal weights over the compatible tables.

Average value per container at tier 1 (40 % buy-back, artifacts at list, 10 000 rolls): ammo tin 102 ₽, ammo crate
216, medical bag 136, medical cabinet 212, footlocker 517, weapon crate 322, armour locker 835, toolbox 314, ration
box 60, explorer's pack 1 003, safe 3 124, desk 46, shelf 57. Tier 3 adds 10-40 %.

## Mimic drops (`scripts/loot/loadout.gd`)
Recruit ≈ 500 ₽ of drops, regular ≈ 1 600, veteran ≈ 3 400, sniper ≈ 2 900, shotgunner ≈ 2 100, gunner ≈ 5 100,
elite ≈ 7 400 (weapon at 30-85 % condition, fouled 0.1-0.6, magazine 35-100 % spent, 1-4 spares of which 30 % part
empty, armour dropped 40 % of the time at 45-100 % durability, one pocket item 50 %, grenades when carried, loose
rounds). Attachments roll rails first so a light or grip can mount (veterans 78 % carry something, elites 60 %). The
class mix by POI and Tide is `class_mix.json`: a tier-1 village is 55 % recruits; the ridge at Tide 2 rolls elites.

## Economy (`scripts/base/economy.gd`)
- Buy-back **40 %** of list. Weapons: list + attachments + inserted magazine, × `(0.5 + 0.5 × condition)`; armour ×
  `(0.5 + 0.5 × durability fraction)`; magazines and stackables flat. Loaded rounds go back to the kit before the gun
  is sold. A 40 % AKM with a Kobra fetches 1 109 ₽ against 1 584 new.
- Ammunition is bought and sold in lots of 10. Artifacts only at the terminal, at full list (1 400-7 200 ₽).
- Clearance (`data/ranks.json`): 2 at 6 000 ₽ + 2 contracts, 3 at 18 000 + 6, 4 at 45 000 + 12, 5 at 100 000 + 20.
  Granted by `check_promotion` on every earning and contract, never lowered, announced as
  `Clearance N granted. Grade: … Requisition and contract tiers widened accordingly.` (`Events.notice`, kind
  `clearance`).
- Mission pay comes from the missions system (`pay_mission`): level-1 contracts ≈ 900 base × distance factor
  1.1-1.9 → 1 000-1 700 ₽; artifact contracts pay list × 1.35-1.5.

## Kit (`scripts/player/kit.gd`, `scripts/player/damage.gd`)
- One cell type: torch 7 in-game hours, headlamp 5, night vision 4 (1 in-game hour = 60 real seconds).
- Filters: 100-unit filter lasts 2 in-game hours of full gas, the GP-7's 160 lasts 3.2. Respirator halves the burn,
  GP-5/GP-7 stop it; a spent filter protects nothing.
- Detectors tick from 2.0 s at range to 0.08 s under 2 m (Veer 30 m; Bear 50 m + needle; Svarog 70 m + type).
- Consumables take their `use` seconds (bandage 3, IFAK 5, AI-2 6, morphine 1.5, stim 1.2); effects per
  `items.json`; painkiller −10 % damage for 90 s; cigarettes ×0.6 sway/spread for 60 s; adrenaline ×1.15 speed 30 s.
- Bleeding: penetrating gunshot or slash of 8+ starts it, 1 HP / 3 s, lethal outside the base, stalls at 1 HP inside.
- Load: capacity 10 kg + pack (Tortilla 12, Pilgrim 20, Attack 2 30, 6Sh118 42). Walking slows to 0.6× and stamina
  drain rises to 2× between capacity and 1.5× capacity; at 1.5× you cannot sprint. Vests and helmets add their own
  `speed`/`stamina` multipliers (6B43 0.9 / 1.25).
- Magazines: reloads prefer the rig pouches (rig `readyMags`: belt 2, 6Sh112 4, Alpha 6, SMERSH 8), then the fullest,
  then the preferred round with a 5-round edge.
