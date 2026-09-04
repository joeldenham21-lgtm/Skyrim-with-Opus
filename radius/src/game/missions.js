// STUB — owned by the game agent. Mission generation (UNPSC register), tracking, rewards, security level.
export function createMissions(ctx) {
  return { active: [], available() { return []; }, accept(id) {}, complete(id) {}, generate() {}, reset() {}, update(dt) {} };
}
