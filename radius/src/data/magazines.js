// Magazines are items: id -> { cal, name, cap, weight, price, rank, rarity, fits: [weapon family tags], kind }
//
// A magazine runs about 5 % of the rifle it feeds, and the rig decides how many of them reload fast. That is
// deliberate: spare magazines are the cheapest capability upgrade in the game and the first thing an Explorer
// should be buying, ahead of a better gun. Drums and quad-stacks cost several times a stick because carrying
// sixty rounds you do not have to reload is worth more than the rounds.
const M = (id, cal, name, cap, weight, price, rank, rarity, fits, extra = {}) => [id, Object.assign({ id, cal, name, cap, weight, price, rank, rarity, fits, kind: 'mag' }, extra)];
export const MAGAZINES = Object.fromEntries([
  M('mag_pm8',     '9x18', 'PM magazine, 8',            8,  0.08, 60,  1, 'common',   ['pm']),
  M('mag_pmm12',   '9x18', 'PMM magazine, 12',          12, 0.10, 130,  2, 'uncommon', ['pm']),
  M('mag_aps20',   '9x18', 'APS magazine, 20',          20, 0.14, 210, 2, 'uncommon', ['aps']),
  M('mag_kedr20',  '9x18', 'Kedr magazine, 20',         20, 0.15, 140,  1, 'common',   ['kedr']),
  M('mag_kedr30',  '9x18', 'Kedr magazine, 30',         30, 0.20, 240, 2, 'uncommon', ['kedr']),
  M('mag_bizon64', '9x18', 'Bizon helical, 64',         64, 0.45, 620, 3, 'rare',     ['bizon']),
  M('mag_tt8',     '7.62x25', 'TT magazine, 8',         8,  0.09, 60,  1, 'common',   ['tt']),
  M('mag_ppsh35',  '7.62x25', 'PPSh stick, 35',         35, 0.35, 260, 2, 'uncommon', ['ppsh']),
  M('mag_ppsh71',  '7.62x25', 'PPSh drum, 71',          71, 0.90, 680, 3, 'rare',     ['ppsh']),
  M('mag_glock17', '9x19', 'Glock magazine, 17',        17, 0.10, 150,  2, 'common',   ['glock']),
  M('mag_glock33', '9x19', 'Glock extended, 33',        33, 0.18, 380, 3, 'uncommon', ['glock']),
  M('mag_m9_15',   '9x19', 'M9 magazine, 15',           15, 0.10, 140,  2, 'common',   ['m9']),
  M('mag_mp5_30',  '9x19', 'MP5 magazine, 30',          30, 0.22, 300, 2, 'uncommon', ['mp5']),
  M('mag_vityaz30','9x19', 'Vityaz magazine, 30',       30, 0.24, 290, 2, 'uncommon', ['vityaz']),
  M('mag_1911_7',  '.45', '1911 magazine, 7',           7,  0.09, 130,  2, 'uncommon', ['m1911']),
  M('mag_1911_10', '.45', '1911 extended, 10',          10, 0.12, 280, 3, 'rare',     ['m1911']),
  M('mag_ak545_30','5.45x39', 'AK-74 magazine, 30',     30, 0.23, 280, 2, 'common',   ['ak545']),
  M('mag_ak545_45','5.45x39', 'RPK-74 magazine, 45',    45, 0.34, 520, 3, 'uncommon', ['ak545']),
  M('mag_ak545_60','5.45x39', '5.45 quad-stack, 60',    60, 0.52, 980, 4, 'rare',     ['ak545']),
  M('mag_ak762_30','7.62x39', 'AKM magazine, 30',       30, 0.33, 260, 1, 'common',   ['ak762']),
  M('mag_ak762_40','7.62x39', 'RPK magazine, 40',       40, 0.45, 480, 2, 'uncommon', ['ak762']),
  M('mag_ak762_75','7.62x39', 'RPK drum, 75',           75, 1.20, 1100, 3, 'rare',     ['ak762']),
  M('mag_sks10',   '7.62x39', 'SKS clip, 10',           10, 0.05, 45,  1, 'common',   ['sks'], { clip: true }),
  M('mag_sks20',   '7.62x39', 'SKS detachable, 20',     20, 0.30, 360, 2, 'uncommon', ['sks']),
  M('mag_stanag30','5.56x45', 'STANAG magazine, 30',    30, 0.16, 320, 3, 'uncommon', ['ar']),
  M('mag_stanag60','5.56x45', '5.56 drum, 60',          60, 0.60, 1100, 4, 'rare',     ['ar']),
  M('mag_vss10',   '9x39', 'VSS magazine, 10',          10, 0.18, 340, 3, 'uncommon', ['vss']),
  M('mag_vss20',   '9x39', 'Val magazine, 20',          20, 0.30, 620, 3, 'uncommon', ['vss']),
  M('mag_sr3_30',  '9x39', 'SR-3M magazine, 30',        30, 0.42, 950, 4, 'rare',     ['vss']),
  M('mag_svd10',   '7.62x54', 'SVD magazine, 10',       10, 0.22, 480, 3, 'uncommon', ['svd']),
  M('mag_sv98_10', '7.62x54', 'SV-98 magazine, 10',     10, 0.25, 650, 4, 'rare',     ['sv98']),
  M('mag_mosin5',  '7.62x54', 'Mosin clip, 5',          5,  0.03, 32,  1, 'common',   ['mosin'], { clip: true }),
  M('mag_pkm100',  '7.62x54', 'PKM belt box, 100',      100, 2.4, 2200, 5, 'rare',    ['pkm']),
  M('mag_saiga8',  '12ga', 'Saiga magazine, 8',         8,  0.30, 320, 2, 'uncommon', ['saiga']),
  M('mag_saiga12', '12ga', 'Saiga magazine, 12',        12, 0.42, 620, 3, 'rare',     ['saiga']),
  M('mag_saiga20', '12ga', 'Saiga drum, 20',            20, 0.90, 1400, 4, 'rare',     ['saiga']),
]);
