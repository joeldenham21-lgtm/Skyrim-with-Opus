// STUB — owned by the gear agent. Headgear (headlamp, night vision), masks, batteries and filters, binoculars,
// quick slots 6-9 (consumables via ctx.damage.use, grenades), grenade throwing, smoke registry, detector tiers.
export function createGear(ctx) {
  return { update(dt) {}, useQuick(i) {}, throwGrenade(id) {}, nvgOn: false, headlampOn: false };
}
